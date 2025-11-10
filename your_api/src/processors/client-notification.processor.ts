import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { TransactionService } from "../services/transaction.service";
import { ClientService } from "../services/client.service";

interface ClientNotificationJobData {
  transactionId: string;
  clientTransactionId: string;
  status: "accepted" | "declined";
}

@Processor("client-notification")
export class ClientNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(ClientNotificationProcessor.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly clientService: ClientService,
  ) {
    super();
  }

  async process(job: Job<ClientNotificationJobData>): Promise<void> {
    const { transactionId, clientTransactionId, status } = job.data;
    this.logger.log(
      `Notifying client about transaction ${clientTransactionId}: ${status}`,
    );

    try {
      const transaction = await this.transactionService.findById(transactionId);

      if (!transaction) {
        this.logger.error(`Transaction ${transactionId} not found`);
        return;
      }

      if (transaction.clientNotified) {
        this.logger.log(
          `Client already notified for ${clientTransactionId}, skipping`,
        );
        return;
      }

      await this.clientService.notifyTransactionStatus(
        clientTransactionId,
        status,
      );

      await this.transactionService.markClientNotified(transactionId);

      this.logger.log(
        `Client successfully notified for ${clientTransactionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify client for ${clientTransactionId}:`,
        error,
      );
      throw error;
    }
  }
}
