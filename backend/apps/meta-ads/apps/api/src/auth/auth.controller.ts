import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { z } from 'zod';
import { JwtAuthGuard } from './jwt.guard';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  orgName: z.string().min(2),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown) {
    const input = registerSchema.parse(body);
    return this.auth.register(input);
  }

  @Post('login')
  async login(@Body() body: unknown) {
    const input = loginSchema.parse(body);
    return this.auth.login(input);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    return { userId: req.user.sub, orgId: req.user.orgId, role: req.user.role };
  }
}
