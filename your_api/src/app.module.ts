import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { Transaction } from "./entities/transaction.entity";
import { TransactionController } from "./transaction.controller";
import { TransactionService } from "./services/transaction.service";
import { ThirdPartyService } from "./services/third-party.service";
import { ClientService } from "./services/client.service";
import { TransactionProcessor } from "./processors/transaction.processor";
import { StatusCheckProcessor } from "./processors/status-check.processor";
import { ClientNotificationProcessor } from "./processors/client-notification.processor";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      username: process.env.DB_USERNAME || "djamo",
      password: process.env.DB_PASSWORD || "djamo_dev",
      database: process.env.DB_DATABASE || "transactions",
      entities: [Transaction],
      synchronize: true, // Auto-create tables (disable in production)
    }),
    TypeOrmModule.forFeature([Transaction]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
    }),
    BullModule.registerQueue(
      { name: "transaction-processing" },
      { name: "status-check" },
      { name: "client-notification" },
    ),
  ],
  controllers: [AppController, TransactionController],
  providers: [
    AppService,
    TransactionService,
    ThirdPartyService,
    ClientService,
    TransactionProcessor,
    StatusCheckProcessor,
    ClientNotificationProcessor,
  ],
})
export class AppModule {}
