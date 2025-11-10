import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

export interface ClientNotificationPayload {
  id: string;
  status: "accepted" | "declined";
}

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.CLIENT_URL || "http://localhost:3100";
  }

  async notifyTransactionStatus(
    id: string,
    status: "accepted" | "declined",
  ): Promise<void> {
    try {
      this.logger.log(`Notifying client about transaction ${id}: ${status}`);

      await axios.put(
        `${this.baseUrl}/transaction`,
        {
          status: {
            id,
            status,
          },
        },
        {
          timeout: 10000,
        },
      );

      this.logger.log(`Client notified successfully for ${id}`);
    } catch (error) {
      this.logger.error(`Failed to notify client for ${id}:`, error);
      throw error;
    }
  }
}
