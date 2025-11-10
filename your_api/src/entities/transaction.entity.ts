import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum TransactionStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  DECLINED = "declined",
  FAILED = "failed",
}

@Entity("transactions")
@Index(["status"])
@Index(["clientTransactionId"], { unique: true })
export class Transaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  clientTransactionId: string;

  @Column({
    type: "enum",
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ nullable: true })
  thirdPartyStatus: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastAttemptAt: Date;

  @Column({ default: 0 })
  attemptCount: number;

  @Column({ default: false })
  webhookReceived: boolean;

  @Column({ default: false })
  clientNotified: boolean;
}
