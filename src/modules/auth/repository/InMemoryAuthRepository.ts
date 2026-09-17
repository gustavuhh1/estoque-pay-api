import { User } from "../model/User"
import type { IAuthRepository } from "./IAuthRepository"

export class InMemoryAuthRepository implements IAuthRepository {
  public users: User[] = []

  async findByEmail(email: string): Promise<User | null> {
    const user = this.users.find((u) => u.email == email) || null
    return user
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.find((u) => u.id == id)
    return user || null
  }

  async create(user: User): Promise<void> {
    const newUser = new User(user)
    this.users.push(newUser)
  }
}
