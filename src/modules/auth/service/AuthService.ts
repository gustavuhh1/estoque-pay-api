import { type IAuthRepository } from "../repository/IAuthRepository";
import type { SignUpDTO, SignInDTO } from "../dto/auth.dto";
import { auth } from "@/lib/auth";

export class AuthService {
  constructor(private authRepository: IAuthRepository) {}

  async signUp(data: SignUpDTO) {
    const existingUser = await this.authRepository.findByEmail(data.email);

    if (existingUser) {
      throw new Error("Usuário já cadastrado");
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
    });

    return { message: "Usuário criado com sucesso", user: response.user };
  }

  async signIn(data: SignInDTO) {
    const user = await this.authRepository.findByEmail(data.email);

    if (!user) {
      throw new Error("Credenciais inválidas");
    }

    // Utilizando o better-auth para login e gestão de sessão
    const response = await auth.api.signInEmail({
      body: {
        email: data.email,
        password: data.password,
      },
    });

    if (!response.user) {
      throw new Error("Credenciais inválidas");
    }

    return { message: "Login realizado com sucesso", user: response.user };
  }

  async requestResetPassword(email: string) {
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new Error("Credenciais inválidas");
    }
    const response = await auth.api.requestPasswordReset({
      body: {
        email: user.email,
        //TODO: Implementar a URL de redirecionamento para a página de redefinição de senha
        redirectTo: `${process.env.APP_URL}/reset-password`,
      },
    });

    return response;
  }

  async resetPassword(token: string, password: string) {
    const response = await auth.api.resetPassword({
      body: {
        token,
        newPassword: password,
      },
    });
    return response;
  }

  //async signOut() {
    // Utilizando o better-auth para logout e gestão de sessão no client 
    // (não é necessário invalidar o token no servidor, pois o better-auth gerencia a sessão do usuário)
  //}
}
