import { type IAuthRepository } from "../repository/IAuthRepository";
import type { SignUpDTO, SignInDTO } from "../dto/auth.dto";
import { auth } from "@/lib/auth";
import { APIError } from "better-auth/api";
import { EmailAlreadyInUseError, UnauthorizedError } from "@/shared/errors";

export class AuthService {
  constructor(private authRepository: IAuthRepository) {}

  async signUp(data: SignUpDTO) {
    // Caminho rápido: evita chamar o better-auth para um e-mail já conhecido.
    const existingUser = await this.authRepository.findByEmail(data.email);

    if (existingUser) {
      throw new EmailAlreadyInUseError();
    }

    try {
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
    } catch (error) {
      // Corrida: entre o pré-check e o insert outro request pode ter criado o
      // mesmo e-mail. O better-auth engole o P2002 do Prisma e responde um
      // genérico 422 FAILED_TO_CREATE_USER, então confirmamos no banco quem
      // ganhou a corrida antes de decidir o status.
      if (error instanceof APIError) {
        const conflictingUser = await this.authRepository.findByEmail(
          data.email
        );

        if (conflictingUser) {
          throw new EmailAlreadyInUseError();
        }
      }

      throw error;
    }
  }

  async signIn(data: SignInDTO) {
    const user = await this.authRepository.findByEmail(data.email);

    if (!user) {
      throw new UnauthorizedError("Credenciais inválidas");
    }

    // `returnHeaders` é o que devolve o Set-Cookie da sessão. Sem ele o login
    // respondia 200 sem cookie nenhum, e o cliente não conseguia acessar
    // nenhuma rota protegida por requireAuth.
    const { headers, response } = await auth.api.signInEmail({
      body: {
        email: data.email,
        password: data.password,
      },
      returnHeaders: true,
    });

    if (!response.user) {
      throw new UnauthorizedError("Credenciais inválidas");
    }

    return {
      message: "Login realizado com sucesso",
      user: response.user,
      headers,
    };
  }

  async requestResetPassword(email: string) {
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError("Credenciais inválidas");
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
