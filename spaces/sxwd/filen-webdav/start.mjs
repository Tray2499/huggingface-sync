import WebDAVServer from "@filen/webdav"
//WebDAV主机名，如果需要禁止外网访问，请改成127.0.0.1
const hostname = "0.0.0.0"
//WebDAV端口，可改成其他端口
const port =  8080
//是否使用https，暂时不知道怎么配置证书，所以这里禁用了https
const https = false
const server = new WebDAVServer.default({
  hostname,
  port,
  https,
  authMode: "basic"
});
server
  .start()
  .then(() =>
    console.log(`WebDAV 服务端正运行在 ${https ? "https" : "http"}://${hostname === "0.0.0.0" ? "local.webdav.filen.io" : hostname}:${port}`)
  )
  .catch(console.error)