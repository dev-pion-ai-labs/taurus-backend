import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadDir: string;

  constructor(private configService: ConfigService) {
    this.uploadDir =
      this.configService.get<string>('storage.uploadDir') || './uploads';
    this.ensureDir(this.uploadDir);
  }

  /**
   * Save a file to local storage.
   * Returns the relative storage path.
   */
  async saveFile(
    storagePath: string,
    buffer: Buffer,
  ): Promise<string> {
    const fullPath = path.join(this.uploadDir, storagePath);
    this.ensureDir(path.dirname(fullPath));
    await fs.promises.writeFile(fullPath, buffer);
    this.logger.log(`File saved: ${storagePath}`);
    return storagePath;
  }

  /**
   * Delete a file from storage.
   */
  async deleteFile(storagePath: string): Promise<void> {
    const fullPath = path.join(this.uploadDir, storagePath);
    try {
      await fs.promises.unlink(fullPath);
      this.logger.log(`File deleted: ${storagePath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      this.logger.warn(`File not found for deletion: ${storagePath}`);
    }
  }

  /**
   * Get the absolute path for a stored file.
   */
  getFilePath(storagePath: string): string {
    return path.join(this.uploadDir, storagePath);
  }

  /**
   * Build a storage path for an onboarding document.
   */
  buildOnboardingPath(
    organizationId: string,
    documentId: string,
    filename: string,
  ): string {
    return path.join('onboarding', organizationId, documentId, filename);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
