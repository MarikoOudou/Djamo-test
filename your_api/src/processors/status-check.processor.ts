import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { TransactionService } from "../services/transaction.service";
import { ThirdPartyService } from "../services/third-party.service";
import { TransactionStatus } from "../entities/transaction.entity";

interface StatusCheckJobData {
  transactionId: string;
  clientTransactionId: string;
}

@Processor("status-check")
export class StatusCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(StatusCheckProcessor.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly thirdPartyService: ThirdPartyService,
    @InjectQueue("client-notification")
    private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<StatusCheckJobData>): Promise<void> {
    const { transactionId, clientTransactionId } = job.data;
    this.logger.log(`Checking status for transaction ${clientTransactionId}`);

    try {
      const transaction = await this.transactionService.findById(transactionId);

      if (!transaction) {
        this.logger.error(`Transaction ${transactionId} not found`);
        return;
      }

      if (transaction.webhookReceived) {
        this.logger.log(
          `Webhook already received for ${clientTransactionId}, skipping status check`,
        );
        return;
      }

      if (
        transaction.status === TransactionStatus.COMPLETED ||
        transaction.status === TransactionStatus.DECLINED ||
        transaction.status === TransactionStatus.FAILED
      ) {
        this.logger.log(
          `Transaction ${clientTransactionId} already in final state: ${transaction.status}`,
        );
        return;
      }

      const response =
        await this.thirdPartyService.getTransactionStatus(clientTransactionId);

      if (!response) {
        this.logger.warn(
          `Transaction ${clientTransactionId} not found in third party system`,
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

        return;
      }

      this.logger.log(
        `Status check result for ${clientTransactionId}: ${response.status}`,
      );

      if (response.status === "pending") {
        this.logger.log(
          `Transaction ${clientTransactionId} still pending, will retry`,
        );
        throw new Error("Transaction still pending");
      }

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
        `Transaction ${clientTransactionId} status updated to ${finalStatus} via status check`,
      );
    } catch (error) {
      this.logger.error(
        `Error checking status for ${clientTransactionId}:`,
        error,
      );
      throw error;
    }
  }
}
