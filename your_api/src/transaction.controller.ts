import {
  Controller,
  Post,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { TransactionService } from "./services/transaction.service";
import { TransactionStatus } from "./entities/transaction.entity";

interface CreateTransactionDto {
  id: string;
}

interface WebhookDto {
  id: string;
  status: "completed" | "declined";
}

@Controller()
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

  constructor(
    private readonly transactionService: TransactionService,
    @InjectQueue("transaction-processing")
    private readonly transactionQueue: Queue,
    @InjectQueue("client-notification")
    private readonly notificationQueue: Queue,
  ) {}

  @Post("/transaction")
  async createTransaction(@Body() body: CreateTransactionDto) {
    const { id: clientTransactionId } = body;
    this.logger.log(`Received transaction request: ${clientTransactionId}`);

    try {
      // Validate incoming request
      if (!clientTransactionId) {
        throw new HttpException(
          "Invalid transaction ID",
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check if transaction already exists (idempotency)
      let transaction =
        await this.transactionService.findByClientId(clientTransactionId);

      if (transaction) {
        this.logger.log(
          `Transaction ${clientTransactionId} already exists with status: ${transaction.status}`,
        );
        // Return actual status if already exists
        return {
          id: transaction.clientTransactionId,
          status: transaction.status,
        };
      }

      // Create new transaction
      transaction = await this.transactionService.create(clientTransactionId);
      this.logger.log(
        `Created transaction ${clientTransactionId} with internal ID: ${transaction.id}`,
      );

      // Add to processing queue
      await this.transactionQueue.add(
        "process-transaction",
        {
          transactionId: transaction.id,
          clientTransactionId: transaction.clientTransactionId,
        },
        {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        },
      );

      this.logger.log(
        `Transaction ${clientTransactionId} added to processing queue`,
      );

      // Always return pending immediately
      return {
        id: transaction.clientTransactionId,
        status: "pending",
      };
    } catch (error) {
      this.logger.error(
        `Error creating transaction ${clientTransactionId}:`,
        error,
      );
      throw new HttpException(
        "Failed to create transaction",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("/webhook")
  async handleWebhook(@Body() body: WebhookDto) {
    const { id: clientTransactionId, status } = body;
    this.logger.log(`Received webhook for ${clientTransactionId}: ${status}`);

    try {
      const transaction =
        await this.transactionService.findByClientId(clientTransactionId);

      if (!transaction) {
        this.logger.warn(
          `Webhook received for unknown transaction: ${clientTransactionId}`,
        );
        return { received: true };
      }

      // Mark webhook as received
      await this.transactionService.markWebhookReceived(transaction.id);

      // Update transaction status
      const finalStatus =
        status === "completed"
          ? TransactionStatus.COMPLETED
          : TransactionStatus.DECLINED;

      await this.transactionService.updateStatus(
        transaction.id,
        finalStatus,
        status,
      );

      // Notify client
      await this.notificationQueue.add(
        "notify-client",
        {
          transactionId: transaction.id,
          clientTransactionId: transaction.clientTransactionId,
          status: status === "completed" ? "accepted" : "declined",
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      );

      this.logger.log(
        `Webhook processed for ${clientTransactionId}, client notification queued`,
      );

      return { received: true };
    } catch (error) {
      this.logger.error(
        `Error processing webhook for ${clientTransactionId}:`,
        error,
      );
      throw new HttpException(
        "Failed to process webhook",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
