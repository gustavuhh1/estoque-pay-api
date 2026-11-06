import type { FastifyReply, FastifyRequest } from "fastify"
import { UnauthorizedError } from "@/shared/errors"
import type { UpdatePerfilDTO } from "../dto/perfil.dto"
import type { PerfilService } from "../service/PerfilService"

// O body já chega validado pelo schema declarado na rota (mesmo padrão dos outros controllers).
export class PerfilController {
  constructor(private perfilService: PerfilService) {}

  private userId(request: FastifyRequest) {
    if (!request.user) throw new UnauthorizedError("Autenticação necessária.")
    return request.user.id
  }

  /** RF01.7 */
  async buscar(request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send(await this.perfilService.buscar(this.userId(request)))
  }

  async atualizar(request: FastifyRequest<{ Body: UpdatePerfilDTO }>, reply: FastifyReply) {
    return reply.status(200).send(await this.perfilService.atualizar(this.userId(request), request.body))
  }

  async usarFotoDoGoogle(request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send(await this.perfilService.usarFotoDoGoogle(this.userId(request)))
  }
}
