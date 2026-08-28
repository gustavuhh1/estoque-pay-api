import { type IAuthRepository } from "../repository/IAuthRepository"
import type { SignUpDTO, SignInDTO } from "../dto/auth.dto"
import { auth } from "@/lib/auth"

export class AuthService {
  constructor(private authRepository: IAuthRepository) {}

  async signUp(data: SignUpDTO) {
    const existingUser = await this.authRepository.findByEmail(data.email)

    if (existingUser) {
      throw new Error("Usuário já cadastrado")
    }

    const response = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.name ?? "",
        image: data.image,
        rememberMe: data.rememberMe ?? false,
        callbackURL: data.callbackURL,
      },
    })

    return { message: "Usuário criado com sucesso", user: response.user }
  }

  async signIn(data: SignInDTO) {
    const user = await this.authRepository.findByEmail(data.email)

    if (!user) {
      throw new Error("Credenciais inválidas")
    }

    // Utilizando o better-auth para login e gestão de sessão
    const response = await auth.api.signInEmail({
      body: {
        email: data.email,
        password: data.password,
      },
    })

    if (!response.user) {
      throw new Error("Credenciais inválidas")
    }

    return { message: "Login realizado com sucesso", user: response.user }
  }
}
