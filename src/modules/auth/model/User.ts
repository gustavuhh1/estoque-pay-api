import { randomUUID } from "node:crypto"

interface UserProps {
  id?: string
  name?: string | null
  email: string
  emailVerified?: boolean
  image?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export class User {
  private props: Required<UserProps>

  constructor(props: UserProps) {
    this.props = {
      id: props.id ?? randomUUID(),
      name: props.name ?? null,
      email: props.email,
      emailVerified: props.emailVerified ?? false,
      image: props.image ?? null,
      createdAt: props.createdAt ?? new Date(),
      updatedAt: props.updatedAt ?? new Date(),
    }
  }

  get id() {
    return this.props.id
  }
  get name() {
    return this.props.name
  }
  get email() {
    return this.props.email
  }
  get emailVerified() {
    return this.props.emailVerified
  }
  get image() {
    return this.props.image
  }
  get createdAt() {
    return this.props.createdAt
  }
  get updatedAt() {
    return this.props.updatedAt
  }

  // Exemplo de comportamento de domínio
  public verifyEmail() {
    this.props.emailVerified = true
    this.props.updatedAt = new Date()
  }

  public toJSON() {
    return { ...this.props }
  }
}
