import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(input: { email: string; password: string; orgName: string; name?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new UnauthorizedException('Email already exists');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const org = await this.prisma.org.create({
      data: {
        name: input.orgName,
      },
    });
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        memberships: {
          create: {
            orgId: org.id,
            role: 'ADMIN',
          },
        },
      },
    });
    await this.prisma.alertRule.createMany({
      data: [
        { orgId: org.id, type: 'PACING_FAST', isActive: true, config: { pacingUpper: 1.3 } },
        { orgId: org.id, type: 'NO_SPEND', isActive: true, config: { noSpendHours: 6 } },
      ],
    });
    const token = await this.sign(user.id, org.id, 'ADMIN');
    return { token, user: this.sanitize(user), org };
  }

  async login(input: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: { memberships: true } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('No org membership');
    }
    const token = await this.sign(user.id, membership.orgId, membership.role);
    return { token, user: this.sanitize(user) };
  }

  async sign(userId: string, orgId: string, role: string) {
    return this.jwt.signAsync({ sub: userId, orgId, role });
  }

  private sanitize(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
