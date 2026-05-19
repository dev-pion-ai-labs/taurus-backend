import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto } from './dto';
import { JwtAuthGuard } from '../common';

// Refresh tokens are long-lived bearer credentials. Keeping them out of
// JavaScript-reachable storage (no localStorage / no JSON body) is the only
// effective defense against an XSS that steals them. We ship them as an
// httpOnly cookie scoped to the auth endpoints; access tokens stay in the
// JSON body so the frontend can put them in the Authorization header.
const REFRESH_COOKIE = 'taurus_refresh';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  private cookieOptions(): CookieOptions {
    const isProd = this.config.get<string>('app.nodeEnv') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.refreshMaxAgeMs(),
    };
  }

  private refreshMaxAgeMs(): number {
    const exp = this.config.get<string>('jwt.refreshExpiration') ?? '7d';
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const mul = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return value * mul;
  }

  private async issueTokens(
    res: Response,
    pending: Promise<{ accessToken: string; refreshToken: string }>,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await pending;
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions());
    return { accessToken };
  }

  // Tight per-IP cap so an attacker can't spam OTP emails (cost + abuse).
  @Throttle({ default: { limit: 3, ttl: 5 * 60 * 1000 } })
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.email);
  }

  // Tight cap to prevent brute-forcing the 6-digit code.
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @Post('verify-otp')
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueTokens(
      res,
      this.authService.verifyOtp(dto.email, dto.code),
    );
  }

  @Post('refresh')
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Missing refresh token');
    return this.issueTokens(res, this.authService.refreshTokens(token));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
    if (!token) return { message: 'Logged out successfully' };
    return this.authService.logout(token);
  }
}
