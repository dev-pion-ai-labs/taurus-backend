import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma';
import { UsersService } from '../users';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.resend = new Resend(this.configService.get<string>('resend.apiKey')!);
    this.fromEmail = this.configService.get<string>('resend.fromEmail')!;
  }

  async sendOtp(email: string) {
    const user = await this.usersService.findOrCreateByEmail(email);

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        code,
        expiresAt,
      },
    });

    // Send email via Resend
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Your Taurus login code',
        html: `
          <h2>Your verification code</h2>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${code}</p>
          <p>This code expires in 10 minutes.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `,
      });
    } catch (error) {
      this.logger.error('Failed to send OTP email', error);
      throw new BadRequestException('Failed to send verification email');
    }

    return { message: 'Verification code sent to your email' };
  }

  async verifyOtp(email: string, code: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid email or code');

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) throw new UnauthorizedException('Invalid or expired code');

    // Mark OTP as used
    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { usedAt: new Date() },
    });

    return this.generateTokens(user.id, user.email);
  }

  async refreshTokens(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user) throw new UnauthorizedException();

    return this.generateTokens(user.id, user.email);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken
      .update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        // Token may not exist, that's fine
      });
    return { message: 'Logged out successfully' };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.accessSecret')!,
      expiresIn: this.configService.get<string>('jwt.accessExpiration')! as any,
    });

    const refreshToken = crypto.randomUUID();
    const tokenHash = this.hashToken(refreshToken);
    const refreshExpirationStr = this.configService.get<string>('jwt.refreshExpiration')!;
    const expiresAt = this.parseExpiration(refreshExpirationStr);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseExpiration(exp: string): Date {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7d

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }[unit]!;

    return new Date(Date.now() + value * ms);
  }
}
