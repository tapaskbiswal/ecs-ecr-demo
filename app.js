const http = require("node:http");
const os = require("node:os");

const port = Number(process.env.PORT || 3000);
const version = process.env.APP_VERSION || "v1";

const students = [
  { id: 1, name: "Aarohi", course: "Cloud Computing" },
  { id: 2, name: "Rahul", course: "DevOps" },
  { id: 3, name: "Meera", course: "Containerization" }
];

const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  res.setHeader("Content-Type", "application/json");

  if (path === "/health") {
    res.end(JSON.stringify({ status: "ok" }));
  } else if (path === "/students") {
    res.end(JSON.stringify(students));
  } else {
    res.end(JSON.stringify({ message: "Hello from ECS", version, host: os.hostname() }));
  }
});

server.listen(port, () => console.log(`Listening on ${port}`));
