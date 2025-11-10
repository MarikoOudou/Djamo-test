import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction, TransactionStatus } from "../entities/transaction.entity";

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
  ) {}

  async findByClientId(
    clientTransactionId: string,
  ): Promise<Transaction | null> {
    return this.transactionRepository.findOne({
      where: { clientTransactionId },
    });
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.transactionRepository.findOne({ where: { id } });
  }

  async create(clientTransactionId: string): Promise<Transaction> {
    const transaction = this.transactionRepository.create({
      clientTransactionId,
      status: TransactionStatus.PENDING,
    });
    return this.transactionRepository.save(transaction);
  }

  async updateStatus(
    id: string,
    status: TransactionStatus,
    thirdPartyStatus?: string,
  ): Promise<Transaction> {
    const transaction = await this.findById(id);
    if (!transaction) {
      throw new Error(`Transaction ${id} not found`);
    }

    transaction.status = status;
    if (thirdPartyStatus) {
      transaction.thirdPartyStatus = thirdPartyStatus;
    }

    this.logger.log(
      `Transaction ${transaction.clientTransactionId} status updated to ${status}`,
    );
    return this.transactionRepository.save(transaction);
  }

  async markWebhookReceived(id: string): Promise<void> {
    const transaction = await this.findById(id);
    if (transaction) {
      await this.transactionRepository.update(id, {
        webhookReceived: true,
      });
      this.logger.log(
        `Transaction ${transaction.clientTransactionId} marked as webhook received`,
      );
    }
  }

  async markClientNotified(id: string): Promise<void> {
    const transaction = await this.findById(id);
    if (transaction) {
      await this.transactionRepository.update(id, {
        clientNotified: true,
      });
      this.logger.log(
        `Transaction ${transaction.clientTransactionId} marked as client notified`,
      );
    }
  }

  async incrementAttemptCount(id: string): Promise<void> {
    const transaction = await this.findById(id);
    if (transaction) {
      transaction.attemptCount += 1;
      transaction.lastAttemptAt = new Date();
      await this.transactionRepository.save(transaction);
      this.logger.log(
        `Transaction ${transaction.clientTransactionId} attempt count: ${transaction.attemptCount}`,
      );
    }
  }

  async shouldRetry(id: string, maxAttempts: number = 5): Promise<boolean> {
    const transaction = await this.findById(id);
    return transaction ? transaction.attemptCount < maxAttempts : false;
  }
}
