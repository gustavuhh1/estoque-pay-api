import type { PrismaClient } from "@prisma/client"
import { User } from "../model/User"
import type { IAuthRepository } from "./IAuthRepository"

export class AuthPrismaRepository implements IAuthRepository {
  constructor(private prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { email },
    })

    if (!data) return null

    return new User({
      id: data.id,
      email: data.email,
      name: data.name,
      emailVerified: data.emailVerified,
      image: data.image,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    })
  }

  async findById(id: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { id },
    })

    if (!data) return null

    return new User({
      id: data.id,
      email: data.email,
      name: data.name,
      emailVerified: data.emailVerified,
      image: data.image,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    })
  }

  // create(user: User): Promise<void>
  // (Prisma não deve criar usuários, apenas o better-auth que pode fazer isso)
}
