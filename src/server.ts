import { app } from "./app.js"

app.listen({ port: 3333, host: "0.0.0.0" }, function (err, address) {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`Servidor está rodando na Url: ${address}`)
})
