import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosError } from "axios";

export interface ThirdPartyTransactionRequest {
  id: string;
  webhookUrl: string;
}

export interface ThirdPartyTransactionResponse {
  id: string;
  status: "pending" | "completed" | "declined";
  webhookUrl?: string;
}

@Injectable()
export class ThirdPartyService {
  private readonly logger = new Logger(ThirdPartyService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.THIRDPARTY_URL || "http://localhost:3000";
  }

  async createTransaction(
    id: string,
    webhookUrl: string,
  ): Promise<ThirdPartyTransactionResponse> {
    try {
      this.logger.log(`Calling 3rd party for transaction ${id}`);

      const response = await axios.post<ThirdPartyTransactionResponse>(
        `${this.baseUrl}/transaction`,
        {
          id,
          webhookUrl,
        },
        {
          timeout: 3,
        },
      );

      this.logger.log(`3rd party responded for ${id}: ${response.data.status}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (
          axiosError.code === "ECONNABORTED" ||
          axiosError.response?.status === 504
        ) {
          this.logger.warn(`3rd party timeout for transaction ${id}`);
          throw new Error("TIMEOUT");
        }
      }
      this.logger.error(`3rd party error for ${id}:`, error);
      throw error;
    }
  }

  async getTransactionStatus(
    id: string,
  ): Promise<ThirdPartyTransactionResponse | null> {
    try {
      this.logger.log(`Checking status for transaction ${id}`);

      const response = await axios.get<ThirdPartyTransactionResponse>(
        `${this.baseUrl}/transaction/${id}`,
        {
          timeout: 10000,
        },
      );

      this.logger.log(`Status check for ${id}: ${response.data.status}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(`Transaction ${id} not found in 3rd party`);
        return null;
      }
      this.logger.error(`Error checking status for ${id}:`, error);
      throw error;
    }
  }
}
