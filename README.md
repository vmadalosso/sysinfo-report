# SysInfo Report

Ferramenta de diagnóstico de sistema para técnicos de informática. Coleta informações completas do hardware e sistema operacional e exibe tudo em uma interface web local com tema Dracula, atualização em tempo real e exportação para CSV. Funciona como executável standalone — sem precisar instalar Node.js na máquina do cliente.

---

## Funcionalidades

- **Interface web local** com tema Dracula, cards organizados por categoria e barras de progresso
- **Atualização automática** a cada 30 segundos sem recarregar a página
- **Abre o navegador automaticamente** ao iniciar (macOS, Windows e Linux)
- **Exportação para CSV** compatível com Excel (BOM UTF-8)
- **Executável standalone** — usuário final não precisa instalar Node.js
- **Cross-compilation** — gera `.exe` do Windows a partir do macOS

### Dados coletados

| Categoria     | Detalhes                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Sistema       | Fabricante, modelo, serial, placa-mãe, versão da BIOS, uptime            |
| S.O.          | Distro, versão, build, arquitetura, hostname, fuso horário               |
| CPU           | Modelo, fabricante, velocidade base/turbo, núcleos, threads, temperatura |
| RAM           | Total, uso atual, disponível; slots com tipo DDR e frequência            |
| Armazenamento | Discos físicos (tipo SSD/HDD/NVMe) com uso por partição                  |
| GPU           | Modelo, fabricante, VRAM                                                 |
| Monitores     | Modelo real (via EDID), conexão, resolução, taxa de atualização          |
| Rede          | Interfaces ativas com IP, nome da rede Wi-Fi (SSID), MAC, tipo           |
| Bateria       | Percentual, status de carga, tempo restante                              |
| Periféricos   | Impressoras instaladas, dispositivos USB conectados                      |

> No macOS, o nome exato do monitor é lido via `system_profiler SPDisplaysDataType` (EDID), o que retorna o modelo real — ex: "BenQ GL2780" — em vez de um identificador genérico.

---

## Stack

- **Runtime:** [Node.js 18+](https://nodejs.org)
- **Coleta de dados:** [systeminformation](https://systeminformation.io)
- **Servidor HTTP:** `node:http` nativo — sem frameworks externos
- **Frontend:** HTML/CSS/JS vanilla com [Dracula Theme](https://draculatheme.com)
- **Build/distribuição:** [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)

---

## Como usar

### Com Node.js

```bash
# Instalar dependências (apenas na primeira vez)
npm install

# Iniciar
npm start
```

O navegador abre automaticamente em `http://localhost:9999`.

Para usar outra porta:

```bash
PORT=8080 node collectSystemInfo.js
```

`Ctrl+C` para encerrar.

---

### Com o executável (sem Node.js)

Baixe o binário correspondente à plataforma e execute:

**Windows**

```
sysinfo-report-win.exe
```

> O Windows Defender SmartScreen pode exibir um aviso na primeira execução por falta de assinatura digital. Clique em **"Mais informações" → "Executar assim mesmo"**.

**Linux**

```bash
chmod +x sysinfo-report-linux
./sysinfo-report-linux
```

**macOS**

```bash
chmod +x sysinfo-report-macos-arm   # ou sysinfo-report-macos-intel
./sysinfo-report-macos-arm
```

> Se o macOS bloquear: **Preferências do Sistema → Privacidade e Segurança → "Abrir assim mesmo"**.

---

## Gerar os executáveis

```bash
# Instalar dependências (inclui @yao-pkg/pkg)
npm install

mkdir -p dist

npm run build:win        # → dist/sysinfo-report-win.exe
npm run build:linux      # → dist/sysinfo-report-linux
npm run build:mac-arm    # → dist/sysinfo-report-macos-arm   (M1/M2/M3/M4)
npm run build:mac-intel  # → dist/sysinfo-report-macos-intel (Intel)
npm run build:all        # todos de uma vez
```

O `pkg` faz cross-compilation — é possível gerar o `.exe` rodando o build no macOS, sem precisar de uma máquina Windows.

O primeiro build demora mais porque o `pkg` baixa o binário do Node para cada plataforma-alvo. Os seguintes são rápidos.

**Tamanho dos binários gerados**

| Plataforma  | Arquivo                      | Tamanho aprox. |
| ----------- | ---------------------------- | -------------- |
| Windows x64 | `sysinfo-report-win.exe`     | ~55–70 MB      |
| Linux x64   | `sysinfo-report-linux`       | ~45–60 MB      |
| macOS ARM   | `sysinfo-report-macos-arm`   | ~45–60 MB      |
| macOS Intel | `sysinfo-report-macos-intel` | ~45–60 MB      |

O tamanho inclui o runtime do Node.js inteiro embutido no binário.

---

## Configuração

| Variável | Padrão | Descrição              |
| -------- | ------ | ---------------------- |
| `PORT`   | `9999` | Porta do servidor HTTP |

---

## Licença

ISC

---

Feito com 💜 por [Vitor Madalosso](https://github.com/vmadalosso)
