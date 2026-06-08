# Software Design Document — SysInfo Report

## 1. Contexto

Técnicos de informática precisam coletar configurações de hardware de máquinas de clientes de forma rápida e sem depender de instalação de software. O fluxo anterior era manual: abrir "msinfo32", "dxdiag", "Gerenciador de Dispositivos", copiar dados à mão.

Este projeto automatiza a coleta e apresenta tudo em uma interface web local padronizada, gerada por um único executável que o técnico copia para o pendrive.

---

## 2. Objetivos

- Coletar informações relevantes de hardware e SO em uma execução
- Exibir os dados em interface web acessível pelo navegador local
- Funcionar sem instalar Node.js na máquina do cliente (executável standalone)
- Exportar um CSV para documentação do atendimento
- Suportar Windows, Linux e macOS com o mesmo código-base

## 2.1 Não-objetivos

- Monitoramento contínuo em tempo real (não é um dashboard de performance)
- Coleta de dados remotamente (ferramenta local only)
- Interface administrativa ou multi-máquina
- Envio de dados para servidores externos

---

## 3. Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                   collectSystemInfo.js               │
│                                                     │
│  ┌──────────────┐   ┌────────────┐   ┌───────────┐ │
│  │ collectData()│   │  toCSV()   │   │renderHTML()│ │
│  │              │   │            │   │           │ │
│  │ systeminform.│   │ flat rows  │   │ Dracula   │ │
│  │ system_prof. │   │ BOM UTF-8  │   │ template  │ │
│  │ networksetup │   │            │   │ + JS      │ │
│  └──────┬───────┘   └─────┬──────┘   └─────┬─────┘ │
│         └─────────────────┴──────────────── ┘       │
│                     node:http                        │
│              GET /          → HTML                   │
│              GET /api/data  → JSON                   │
│              GET /api/export.csv → CSV download      │
└─────────────────────────────────────────────────────┘
         ↓ pkg bundlea Node.js runtime
  sysinfo-report-win.exe  (standalone, ~60MB)
```

**Sem servidor remoto.** Tudo roda em `127.0.0.1` e fecha quando o processo termina.

---

## 4. Modelo de dados

```js
// Retorno de collectData()
{
  collectedAt: string,           // "08/06/2026, 14:30"

  system: {
    manufacturer, model, serial, baseboard, bios, uptime
  },

  os: {
    distro, release, build, arch, hostname, timezone
  },

  cpu: {
    manufacturer, brand, speed, speedMax,
    cores, threads, temperature  // null se indisponível
  },

  memory: {
    total, used, free,           // bytes
    slots: [{ bank, size, type, speed }]
  },

  disks: [{
    name, vendor, type, size,    // size em bytes
    partitions: [{ fs, mount, size, used, usePercent }]
  }],

  gpu:      [{ vendor, model, vram }],          // vram em MB

  displays: [{
    name, vendor, connection,
    resolution,                  // "1920x1080"
    refresh,                     // Hz, null se indisponível
    serial
  }],

  network: [{
    iface, name,                 // name = SSID ou null
    ip4, mac, type, speed
  }],

  battery: {
    hasBattery, percent, isCharging, timeRemaining
  },

  printers: [{ name, status }],
  usb:      [{ name, type }]
}
```

---

## 5. Decisões técnicas

| Decisão | Alternativa descartada | Motivo |
|---|---|---|
| `node:http` nativo | Express | Sem dependências extras para o servidor; tamanho do bundle menor |
| `child_process.exec` para abrir browser | pacote `open` | Elimina dependência; os 3 SOs têm comandos nativos (`open`, `start`, `xdg-open`) |
| HTML gerado em template literal no servidor | Arquivos estáticos separados | `pkg` tem dificuldades com assets externos; HTML inline elimina o problema |
| `system_profiler SPDisplaysDataType` no macOS | Apenas `si.graphics()` | `si.graphics()` não retorna o modelo do monitor no macOS — EDID só acessível via `system_profiler` |
| `networksetup -getairportnetwork` para SSID | Apenas `si.wifiConnections()` | macOS 13+ restringe acesso ao SSID via API sem Location Services; `networksetup` não exige essa permissão |
| CJS (`require`) em vez de ESM (`import`) | Manter ESM | `@yao-pkg/pkg` tem suporte instável a ESM; CJS é mais confiável para gerar executáveis |
| Atualização a cada 30s | 10s / manual | Dados mudam devagar em diagnóstico; 10s era desnecessário e aumentava carga |
| Filtrar interfaces sem IPv4 | Mostrar todas | Elimina ruído (adaptadores virtuais, VPNs, loopback) — técnico só precisa do IP ativo |
| Filtrar hubs USB | Mostrar todos | Hubs internos/externos não têm utilidade diagnóstica |

---

## 6. Limitações conhecidas

- **Temperatura do CPU:** não disponível em todos os SOs/hardwares (retorna `null`)
- **SSID no macOS:** `networksetup` retorna "not associated" se a interface não for AirPort; o fallback para `si.wifiConnections()` cobre esse caso
- **Modelo do monitor no macOS:** `system_profiler` só retorna nome se o monitor enviar EDID corretamente (monitores via adaptadores sem passthrough de EDID podem não ser identificados)
- **SmartScreen no Windows:** executável sem assinatura digital gera aviso na primeira execução — requer code signing (~$200/ano) para eliminar
- **Tamanho do executável:** ~60 MB por plataforma devido ao Node.js embutido

---

## 7. Status de implementação

### Concluído

- [x] Coleta completa: sistema, SO, CPU, RAM (slots), armazenamento, GPU, monitores, rede, bateria, periféricos
- [x] Interface web com Dracula Theme — cards por categoria, barras de progresso, atualização a cada 30s
- [x] Servidor HTTP nativo, abre browser automaticamente nas 3 plataformas
- [x] Nome real do monitor via `system_profiler` (macOS)
- [x] SSID da rede Wi-Fi via `networksetup` com fallback para `si.wifiConnections()`
- [x] Filtro de rede: só interfaces com IPv4 ativo
- [x] Filtro USB: hubs removidos da listagem
- [x] Exportação CSV com BOM UTF-8 (compatível com Excel)
- [x] Build scripts para Windows, Linux, macOS ARM e Intel via `@yao-pkg/pkg`
- [x] Cross-compilation (`.exe` gerado a partir do macOS)

### Backlog

- [ ] Exportação em PDF via `@media print`
- [ ] Modo `--silent`: gera CSV sem abrir o browser
- [ ] Flag `--port` como argumento de linha de comando
- [ ] Nome do arquivo CSV com timestamp (`sysinfo_2026-06-08_14-30.csv`)
- [ ] Histórico: comparar com coleta anterior e destacar diferenças

---

## 8. Histórico de versões

| Versão | Descrição |
|---|---|
| 1.0.0 | Script inicial: coleta básica (modelo, SO, serial, CPU, uso de RAM) e export CSV |
| 2.0.0 | Reescrita completa: servidor HTTP, interface Dracula, coleta expandida, executável standalone, SSID, monitor real |
