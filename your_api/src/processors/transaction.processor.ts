import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { TransactionService } from "../services/transaction.service";
import { ThirdPartyService } from "../services/third-party.service";
import { TransactionStatus } from "../entities/transaction.entity";

interface TransactionJobData {
  transactionId: string;
  clientTransactionId: string;
}

@Processor("transaction-processing")
export class TransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly thirdPartyService: ThirdPartyService,
    @InjectQueue("status-check") private readonly statusCheckQueue: Queue,
    @InjectQueue("client-notification")
    private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<TransactionJobData>): Promise<void> {
    const { transactionId, clientTransactionId } = job.data;
    this.logger.log(`Processing transaction ${clientTransactionId}`);

    try {
      await this.transactionService.incrementAttemptCount(transactionId);

      await this.transactionService.updateStatus(
        transactionId,
        TransactionStatus.PROCESSING,
      );

      const webhookUrl = `${process.env.YOUR_API_URL || "http://localhost:3001"}/webhook`;

      const response = await this.thirdPartyService.createTransaction(
        clientTransactionId,
        webhookUrl,
      );

      this.logger.log(
        `Third party responded for ${clientTransactionId}: ${response.status}`,
      );

      if (response.status === "completed" || response.status === "declined") {
        const finalStatus =
          response.status === "completed"
            ? TransactionStatus.COMPLETED
            : TransactionStatus.DECLINED;

        await this.transactionService.updateStatus(
          transactionId,
          finalStatus,
          response.status,
        );

        await this.notificationQueue.add("notify-client", {
          transactionId,
          clientTransactionId,
          status: response.status === "completed" ? "accepted" : "declined",
        });

        this.logger.log(
          `Transaction ${clientTransactionId} completed with status: ${response.status}`,
        );
        return;
      }

      this.logger.log(
        `Transaction ${clientTransactionId} is pending, waiting for webhook`,
      );

      await this.statusCheckQueue.add(
        "check-status",
        {
          transactionId,
          clientTransactionId,
        },
        {
          delay: 45000, 
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      );

      this.logger.log(`Status check scheduled for ${clientTransactionId}`);
    } catch (error) {
      if (error instanceof Error && error.message === "TIMEOUT") {
        this.logger.warn(`Timeout for transaction ${clientTransactionId}`);

        await this.statusCheckQueue.add(
          "check-status",
          {
            transactionId,
            clientTransactionId,
          },
          {
            delay: 60000, 
            attempts: 5,
            backoff: {
              type: "exponential",
              delay: 10000,
            },
          },
        );

        this.logger.log(
          `Timeout status check scheduled for ${clientTransactionId}`,
        );
        return;
      }

      const shouldRetry =
        await this.transactionService.shouldRetry(transactionId);

      if (!shouldRetry) {
        this.logger.error(
          `Max retries reached for ${clientTransactionId}, marking as failed`,
        );
        await this.transactionService.updateStatus(
          transactionId,
          TransactionStatus.FAILED,
        );

        await this.notificationQueue.add("notify-client", {
          transactionId,
          clientTransactionId,
          status: "declined",
        });
      }

      throw error;
    }
  }
}
