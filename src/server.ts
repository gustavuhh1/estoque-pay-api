import { app } from "./app.js"
import "dotenv/config"

const PORT = Number(process.env.PORT || 3333)

app.listen({ port: PORT, host: "0.0.0.0" }, function (err, address) {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Servidor está rodando na Url: ${address}`)
})
