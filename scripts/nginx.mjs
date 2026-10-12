import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const image =
  "nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94";
const action = process.argv[2] ?? "serve";
function port(flag, fallback) {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`${flag} requires a port from 1024 to 65535.`);
  return value;
}
const frontPort = port("--port", 8080);
const upstreamPort = port("--upstream", 3000);
const name = `wheretovisit-nginx-${frontPort}`;
function docker(args) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (action === "stop") {
  docker(["stop", name]);
  process.exit(0);
}
if (!["serve", "check"].includes(action))
  throw new Error("Use serve, check or stop.");
// Docker Desktop's default bridge DNS can differ from embedded network DNS.
const dnsProbe = spawnSync(
  "docker",
  ["run", "--rm", "--entrypoint", "cat", image, "/etc/resolv.conf"],
  { encoding: "utf8" },
);
if (dnsProbe.error) throw dnsProbe.error;
if (dnsProbe.status !== 0)
  throw new Error("Could not discover the Docker DNS resolver.");
const nameservers = [
  ...dnsProbe.stdout.matchAll(/^nameserver\s+((?:\d{1,3}\.){3}\d{1,3})\s*$/gm),
].map((match) => match[1]);
if (!nameservers.length)
  throw new Error(
    "This local NGINX workflow requires a Docker IPv4 DNS resolver.",
  );
mkdirSync(".nginx", { recursive: true });
const config = resolve(`.nginx/nginx-${frontPort}.conf`);
writeFileSync(
  config,
  readFileSync("nginx/nginx.conf", "utf8")
    .replace("__DOCKER_DNS__", nameservers.join(" "))
    .replace(
      "host.docker.internal:3000",
      `host.docker.internal:${upstreamPort}`,
    ),
);
const mount = [
  "--mount",
  `type=bind,source=${config},target=/etc/nginx/nginx.conf,readonly`,
];
docker(["run", "--rm", "--entrypoint", "nginx", ...mount, image, "-t"]);
if (action === "check") process.exit(0);
const child = spawn(
  "docker",
  [
    "run",
    "--rm",
    "--name",
    name,
    "-p",
    `127.0.0.1:${frontPort}:8080`,
    ...mount,
    image,
  ],
  { stdio: "inherit" },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  spawnSync("docker", ["stop", "-t", "2", name], { stdio: "ignore" });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(stopping ? 0 : (code ?? 1));
});
