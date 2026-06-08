'use strict'
const http = require('http')
const { exec } = require('child_process')
const os   = require('os')
const si   = require('systeminformation')

const PORT         = Number(process.env.PORT) || 9999
const REFRESH_SECS = 30

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '—'
  const gb = bytes / 1073741824
  if (gb >= 1) return gb.toFixed(1) + ' GB'
  return (bytes / 1048576).toFixed(0) + ' MB'
}

function fmtUptime(secs) {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}min`
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

function nowStr() {
  return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const settled = r => (r.status === 'fulfilled' ? r.value : null)

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 6000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

// ─── coleta de dados ──────────────────────────────────────────────────────────

async function collectData() {
  const [
    rSystem, rBios, rBaseboard, rCpu, rCpuTemp, rMem, rMemLayout,
    rDiskLayout, rFsSize, rGraphics, rNet, rPrinters, rUsb, rBattery, rOs, rWifi
  ] = await Promise.allSettled([
    si.system(), si.bios(), si.baseboard(), si.cpu(), si.cpuTemperature(),
    si.mem(), si.memLayout(), si.diskLayout(), si.fsSize(), si.graphics(),
    si.networkInterfaces(), si.printer(), si.usb(), si.battery(), si.osInfo(),
    si.wifiConnections()
  ])

  const system     = settled(rSystem)     || {}
  const bios       = settled(rBios)       || {}
  const baseboard  = settled(rBaseboard)  || {}
  const cpu        = settled(rCpu)        || {}
  const cpuTemp    = settled(rCpuTemp)    || {}
  const mem        = settled(rMem)        || {}
  const memLayout  = settled(rMemLayout)  || []
  const diskLayout = settled(rDiskLayout) || []
  const fsSize     = settled(rFsSize)     || []
  const graphics   = settled(rGraphics)   || {}
  const net        = settled(rNet)        || []
  const printers   = settled(rPrinters)   || []
  const usb        = settled(rUsb)        || []
  const battery    = settled(rBattery)    || {}
  const osInfo     = settled(rOs)         || {}
  const wifi       = settled(rWifi)       || []

  // Mapa iface → SSID para enriquecer interfaces Wi-Fi com o nome da rede
  // macOS 13+: si.wifiConnections() pode falhar silenciosamente por restrições de Location Services.
  // networksetup -getairportnetwork não requer permissão especial — usamos como fonte primária no macOS.
  const ssidMap = {}

  if (process.platform === 'darwin') {
    const wirelessIfaces = (Array.isArray(net) ? net : [])
      .filter(n => !n.internal && n.type === 'wireless')
      .map(n => n.iface)

    await Promise.allSettled(
      wirelessIfaces.map(async iface => {
        try {
          const out = await execAsync(`networksetup -getairportnetwork ${iface}`)
          const m = out.match(/Current Wi-Fi Network:\s*(.+)/)
          if (m) { ssidMap[iface] = m[1].trim(); return }
        } catch { /* sem permissão ou sem Wi-Fi */ }
        // Fallback: si.wifiConnections()
        const conn = wifi.find(w => w.iface === iface)
        if (conn?.ssid) ssidMap[iface] = conn.ssid
      })
    )
  } else {
    for (const w of wifi) {
      if (w.iface && w.ssid) ssidMap[w.iface] = w.ssid
    }
  }

  // Partições filtradas (sem pseudo-filesystems)
  const filteredFs = fsSize.filter(p =>
    !p.fs.startsWith('tmpfs') &&
    !p.fs.startsWith('/dev/loop') &&
    !p.fs.startsWith('devtmpfs') &&
    p.size > 0
  )

  // Discos físicos com partições
  const disks = diskLayout.length > 0
    ? diskLayout.map(disk => ({
        name:       disk.name   || disk.device || 'Disco',
        vendor:     disk.vendor || null,
        type:       disk.type   || null,
        size:       disk.size   || 0,
        partitions: filteredFs.map(p => ({
          fs: p.fs, mount: p.mount, size: p.size,
          used: p.used, usePercent: Math.round(p.use)
        }))
      }))
    : [{
        name: 'Sistema de Arquivos', type: null, size: 0,
        partitions: filteredFs.map(p => ({
          fs: p.fs, mount: p.mount, size: p.size,
          used: p.used, usePercent: Math.round(p.use)
        }))
      }]

  // GPUs (sem info de monitor — monitores ficam em `displays` abaixo)
  const gpus = (graphics.controllers || []).map(g => ({
    vendor: g.vendor || null,
    model:  g.model  || 'GPU',
    vram:   g.vram   || 0
  }))

  // Monitores ─────────────────────────────────────────────────────────────────
  // macOS: system_profiler lê o EDID e retorna o nome exato do monitor (ex: "BenQ EW3270U")
  // Windows/Linux: systeminformation já retorna o modelo corretamente
  let displays = []

  if (process.platform === 'darwin') {
    try {
      const stdout = await execAsync('system_profiler SPDisplaysDataType -json')
      const spData = JSON.parse(stdout)

      // system_profiler retorna connection_type como chaves localizadas
      const connMap = {
        spdisplays_internal:    'Interno',
        spdisplays_hdmi:        'HDMI',
        spdisplays_displayport: 'DisplayPort',
        spdisplays_thunderbolt: 'Thunderbolt',
        spdisplays_usbc:        'USB-C',
        spdisplays_dp:          'DisplayPort',
        spdisplays_vga:         'VGA',
        spdisplays_dvi:         'DVI',
      }

      for (const gpuEntry of (spData.SPDisplaysDataType || [])) {
        for (const d of (gpuEntry.spdisplays_ndrvs || [])) {
          // spdisplays_resolution = "1920 x 1080 @ 75.00Hz"
          // spdisplays_pixelresolution = chave localizada tipo "spdisplays_2560x1600Retina" — não usar diretamente
          const resStr = d.spdisplays_resolution || ''
          const resMatch     = resStr.match(/(\d+)\s*x\s*(\d+)/)
          const refreshMatch = resStr.match(/@\s*([\d.]+)\s*Hz/)

          let resolution = '—'
          if (resMatch) {
            resolution = `${resMatch[1]}x${resMatch[2]}`
          } else {
            // Fallback: tentar extrair dimensões da chave pixelresolution (ex: spdisplays_2560x1600Retina)
            const pixMatch = (d.spdisplays_pixelresolution || '').match(/(\d{3,5})[xX](\d{3,5})/)
            if (pixMatch) resolution = `${pixMatch[1]}x${pixMatch[2]}`
          }

          const rawConn  = d.spdisplays_connection_type || ''
          const connection = connMap[rawConn] || (rawConn && !rawConn.startsWith('spdisplays_') ? rawConn : '—')

          displays.push({
            name:       d._name                  || '—',
            vendor:     d.spdisplays_vendor       || '—',
            connection,
            resolution,
            refresh:    refreshMatch ? parseFloat(refreshMatch[1]) : null,
            serial:     d.spdisplays_serialnumber || null
          })
        }
      }
    } catch { /* system_profiler indisponível */ }
  }

  // Fallback para Windows/Linux, ou se system_profiler falhou
  if (displays.length === 0) {
    displays = (graphics.displays || []).map(d => ({
      name:       d.model      || '—',
      vendor:     d.vendor     || '—',
      connection: d.connection || '—',
      resolution: d.resolutionX && d.resolutionY ? `${d.resolutionX}x${d.resolutionY}` : '—',
      refresh:    d.currentRefreshRate || null,
      serial:     null
    }))
  }

  // Rede: apenas interfaces com IPv4 ativo (exclui VPNs, adaptadores virtuais, sem IP)
  const network = (Array.isArray(net) ? net : [])
    .filter(n => !n.internal && n.ip4 && n.ip4 !== '' && n.ip4 !== '0.0.0.0')
    .map(n => ({
      iface:     n.iface,
      name:      ssidMap[n.iface] || null,  // nome da rede Wi-Fi (SSID) quando disponível
      ip4:       n.ip4   || '—',
      mac:       n.mac   || '—',
      type:      n.type  || 'Ethernet',
      speed:     n.speed || null
    }))

  // USB: filtra hubs (concentradores internos/externos sem utilidade diagnóstica)
  const usbDevices = usb
    .filter(u => u.name && u.type !== 'Hub')
    .slice(0, 20)
    .map(u => ({ name: u.name, type: u.type || '—' }))

  return {
    collectedAt: nowStr(),
    system: {
      manufacturer: system.manufacturer || '—',
      model:        system.model        || '—',
      serial:       system.serial       || '—',
      baseboard:    [baseboard.manufacturer, baseboard.model].filter(Boolean).join(' ') || '—',
      bios:         [bios.vendor, bios.version, bios.releaseDate ? `(${bios.releaseDate})` : '']
                      .filter(Boolean).join(' ') || '—',
      uptime:       fmtUptime(os.uptime())
    },
    os: {
      distro:   osInfo.distro   || os.type(),
      release:  osInfo.release  || os.release(),
      build:    osInfo.build    || '—',
      arch:     osInfo.arch     || os.arch(),
      hostname: osInfo.hostname || os.hostname(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    cpu: {
      manufacturer: cpu.manufacturer || '—',
      brand:        cpu.brand        || '—',
      speed:        cpu.speed    ? `${cpu.speed} GHz`    : '—',
      speedMax:     cpu.speedMax ? `${cpu.speedMax} GHz` : '—',
      cores:        cpu.physicalCores || cpu.cores || '—',
      threads:      cpu.cores        || '—',
      temperature:  cpuTemp.main     || null
    },
    memory: {
      total: mem.total,
      used:  mem.active || mem.used,
      free:  mem.available || mem.free,
      slots: memLayout
        .filter(s => s.size > 0)
        .map(s => ({
          bank:  s.bank || s.slot || '—',
          size:  s.size,
          type:  s.type          || '—',
          speed: s.clockSpeed || s.speed || null
        }))
    },
    disks,
    gpu: gpus,
    displays,
    network,
    battery: {
      hasBattery:    battery.hasBattery || false,
      percent:       battery.percent    || 0,
      isCharging:    battery.isCharging || false,
      timeRemaining: battery.timeRemaining > 0 ? battery.timeRemaining : null
    },
    printers:    printers.map(p => ({ name: p.name, status: p.status || '—' })),
    usb:         usbDevices
  }
}

// ─── exportação CSV ───────────────────────────────────────────────────────────

function toCSV(data) {
  const rows = [
    ['Campo', 'Valor'],
    ['Coletado em',            data.collectedAt],
    ['Hostname',               data.os.hostname],
    ['Fabricante',             data.system.manufacturer],
    ['Modelo',                 data.system.model],
    ['Serial',                 data.system.serial],
    ['Placa-mãe',              data.system.baseboard],
    ['BIOS',                   data.system.bios],
    ['Uptime',                 data.system.uptime],
    ['Sistema Operacional',    data.os.distro],
    ['Versão SO',              data.os.release],
    ['Build SO',               data.os.build],
    ['Arquitetura',            data.os.arch],
    ['Fuso Horário',           data.os.timezone],
    ['CPU',                    data.cpu.brand],
    ['CPU Fabricante',         data.cpu.manufacturer],
    ['CPU Velocidade Base',    data.cpu.speed],
    ['CPU Velocidade Turbo',   data.cpu.speedMax],
    ['CPU Núcleos Físicos',    data.cpu.cores],
    ['CPU Threads',            data.cpu.threads],
    ['CPU Temperatura',        data.cpu.temperature ? `${data.cpu.temperature}°C` : 'N/A'],
    ['RAM Total',              fmtBytes(data.memory.total)],
    ['RAM Em Uso',             fmtBytes(data.memory.used)],
    ['RAM Disponível',         fmtBytes(data.memory.free)],
  ]

  data.memory.slots.forEach((s, i) => {
    rows.push([`RAM Slot ${i + 1}`, `${fmtBytes(s.size)} ${s.type}${s.speed ? ` ${s.speed} MHz` : ''}`])
  })

  data.disks.forEach(disk => {
    disk.partitions.forEach(p => {
      rows.push([`Disco ${p.mount}`, `${fmtBytes(p.used)} / ${fmtBytes(p.size)} (${p.usePercent}%)`])
    })
  })

  data.gpu.forEach((g, i) => {
    rows.push([`GPU ${i + 1}`, `${g.vendor || ''} ${g.model}`.trim()])
    if (g.vram) rows.push([`GPU ${i + 1} VRAM`, fmtBytes(g.vram * 1048576)])
  })

  data.displays.forEach((d, i) => {
    rows.push([`Monitor ${i + 1}`,            d.name])
    rows.push([`Monitor ${i + 1} Conexão`,    d.connection])
    rows.push([`Monitor ${i + 1} Resolução`,  d.resolution + (d.refresh ? ` @ ${d.refresh}Hz` : '')])
    if (d.serial) rows.push([`Monitor ${i + 1} Serial`, d.serial])
  })

  data.network.forEach(n => {
    rows.push([`Rede ${n.iface} IP`,  n.ip4])
    rows.push([`Rede ${n.iface} MAC`, n.mac])
  })

  if (data.battery.hasBattery) {
    rows.push(['Bateria', `${data.battery.percent}%${data.battery.isCharging ? ' (carregando)' : ''}`])
  }

  data.printers.forEach(p => rows.push(['Impressora', p.name]))
  data.usb.forEach(u => rows.push(['USB', `${u.name} (${u.type})`]))

  return rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\r\n')
}

// ─── HTML da interface web ────────────────────────────────────────────────────

function renderHTML(data) {
  const json = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SysInfo — ${data.os.hostname}</title>
<style>
:root {
  --bg:      #282a36;
  --surface: #383a47;
  --card:    #44475a;
  --fg:      #f8f8f2;
  --comment: #6272a4;
  --cyan:    #8be9fd;
  --green:   #50fa7b;
  --orange:  #ffb86c;
  --pink:    #ff79c6;
  --purple:  #bd93f9;
  --red:     #ff5555;
  --yellow:  #f1fa8c;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;padding:20px 24px 48px}

#topbar{position:fixed;top:0;left:0;right:0;height:3px;background:var(--surface);z-index:99}
#topbar-fill{height:100%;background:var(--purple);width:100%}

header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:28px;padding:16px 0 18px;border-bottom:1px solid var(--card)}
.h-title{font-size:18px;font-weight:700;color:var(--purple);letter-spacing:-.01em}
.h-sub{font-size:12px;color:var(--comment);margin-top:2px}
.h-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.badge-timer{font-size:12px;color:var(--comment);background:var(--card);padding:5px 11px;border-radius:6px}
.btn{background:var(--purple);color:#1a1b26;border:none;padding:7px 16px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;transition:filter .15s}
.btn:hover{filter:brightness(1.12)}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:18px 20px}
.card.w2{grid-column:span 2}
@media(max-width:660px){.card.w2{grid-column:1/-1}}

.card-title{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--purple);padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.06)}

.row{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;gap:12px;border-bottom:1px solid rgba(255,255,255,.04)}
.row:last-child{border-bottom:none;padding-bottom:0}
.rl{color:var(--comment);font-size:12px;flex-shrink:0}
.rv{font-size:12px;text-align:right;word-break:break-all}
.c-fg{color:var(--fg)} .c-cyan{color:var(--cyan)} .c-green{color:var(--green)}
.c-orange{color:var(--orange)} .c-red{color:var(--red)} .c-purple{color:var(--purple)}
.c-comment{color:var(--comment)}

.prog{margin:10px 0 6px}
.prog-header{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px}
.prog-lbl{color:var(--comment)}
.prog-track{height:7px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
.prog-fill{height:100%;border-radius:4px;transition:width .4s ease}
.f-green{background:var(--green)} .f-orange{background:var(--orange)} .f-red{background:var(--red)}

.tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.t-green{background:rgba(80,250,123,.14);color:var(--green)}
.t-red{background:rgba(255,85,85,.14);color:var(--red)}
.t-cyan{background:rgba(139,233,253,.14);color:var(--cyan)}
.t-purple{background:rgba(189,147,249,.14);color:var(--purple)}
.t-comment{background:rgba(98,114,164,.14);color:var(--comment)}

table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
th{text-align:left;color:var(--comment);font-weight:600;font-size:11px;padding:3px 0 7px;border-bottom:1px solid rgba(255,255,255,.08)}
td{padding:5px 8px 5px 0;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}
td:last-child{text-align:right;padding-right:0}
tr:last-child td{border-bottom:none}

.disk{margin-bottom:16px} .disk:last-child{margin-bottom:0}
.disk-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.disk-name{font-size:13px;font-weight:600}
.partition{margin-bottom:8px} .partition:last-child{margin-bottom:0}

.block{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.block:first-child{padding-top:0} .block:last-child{border-bottom:none;padding-bottom:0}
.block-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.block-name{font-size:13px;font-weight:600}

.sub{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--comment);margin:14px 0 8px}
.sub:first-child{margin-top:0}
</style>
</head>
<body>
<div id="topbar"><div id="topbar-fill"></div></div>
<header>
  <div>
    <div class="h-title">SysInfo Report</div>
    <div class="h-sub" id="collected-at">Coletado em: ${data.collectedAt}</div>
  </div>
  <div class="h-right">
    <div class="badge-timer">Atualiza em <span id="countdown">${REFRESH_SECS}</span>s</div>
    <button class="btn" onclick="exportCSV()">&#8659; Exportar CSV</button>
  </div>
</header>
<div id="app" class="grid"></div>

<script>
const _d = ${json};
const REFRESH = ${REFRESH_SECS};

const fmtB = b => {
  if (!b || b === 0) return '—';
  const g = b / 1073741824;
  if (g >= 1) return g.toFixed(1) + ' GB';
  return (b / 1048576).toFixed(0) + ' MB';
};
const pct  = (u, t) => t > 0 ? Math.round(u / t * 100) : 0;
const fCls = p => p >= 90 ? 'f-red' : p >= 70 ? 'f-orange' : 'f-green';
const cCls = p => p >= 90 ? 'c-red' : p >= 70 ? 'c-orange' : 'c-green';
const row  = (l, v, c='c-fg') => \`<div class="row"><span class="rl">\${l}</span><span class="rv \${c}">\${v??'—'}</span></div>\`;
const tag  = (t, c) => \`<span class="tag t-\${c}">\${t}</span>\`;
const prog = (lbl, p, left, right) => \`<div class="prog">
  <div class="prog-header"><span class="prog-lbl">\${lbl}</span><span class="\${cCls(p)}">\${left} · \${right}</span></div>
  <div class="prog-track"><div class="prog-fill \${fCls(p)}" style="width:\${p}%"></div></div>
</div>\`;

function render(d) {
  document.getElementById('collected-at').textContent = 'Coletado em: ' + d.collectedAt;
  const s = d.system, o = d.os, c = d.cpu, m = d.memory;
  const cards = [];

  cards.push(\`<div class="card">
    <div class="card-title">Sistema</div>
    \${row('Fabricante', s.manufacturer)}
    \${row('Modelo', s.model, 'c-cyan')}
    \${row('Serial', s.serial)}
    \${row('Placa-mãe', s.baseboard)}
    \${row('BIOS', s.bios)}
    \${row('Uptime', s.uptime)}
  </div>\`);

  cards.push(\`<div class="card">
    <div class="card-title">Sistema Operacional</div>
    \${row('Sistema', o.distro, 'c-cyan')}
    \${row('Versão', o.release)}
    \${row('Build', o.build)}
    \${row('Arquitetura', o.arch)}
    \${row('Hostname', o.hostname, 'c-purple')}
    \${row('Fuso Horário', o.timezone)}
  </div>\`);

  const tC = c.temperature ? (c.temperature > 85 ? 'c-red' : c.temperature > 70 ? 'c-orange' : 'c-green') : 'c-fg';
  cards.push(\`<div class="card">
    <div class="card-title">Processador</div>
    \${row('Modelo', c.brand, 'c-cyan')}
    \${row('Fabricante', c.manufacturer)}
    \${row('Velocidade Base', c.speed)}
    \${row('Velocidade Turbo', c.speedMax)}
    \${row('Núcleos Físicos', c.cores)}
    \${row('Threads (Lógicos)', c.threads)}
    \${c.temperature ? row('Temperatura', c.temperature + '°C', tC) : ''}
  </div>\`);

  const mp = pct(m.used, m.total);
  const slotsHtml = m.slots.length ? \`<table>
    <thead><tr><th>Slot</th><th>Tamanho</th><th>Tipo</th><th>Freq.</th></tr></thead>
    <tbody>\${m.slots.map(s => \`<tr>
      <td>\${s.bank}</td><td>\${fmtB(s.size)}</td><td>\${s.type}</td><td>\${s.speed ? s.speed + ' MHz' : '—'}</td>
    </tr>\`).join('')}</tbody>
  </table>\` : '';
  cards.push(\`<div class="card">
    <div class="card-title">Memória RAM</div>
    \${prog('Uso', mp, fmtB(m.used), fmtB(m.total))}
    \${row('Total instalado', fmtB(m.total), 'c-cyan')}
    \${row('Em uso', fmtB(m.used))}
    \${row('Disponível', fmtB(m.free), 'c-green')}
    \${slotsHtml}
  </div>\`);

  if (d.disks && d.disks.length) {
    const dHtml = d.disks.map(disk => {
      const pH = (disk.partitions || []).map(p => {
        const dp = p.usePercent ?? pct(p.used, p.size);
        return \`<div class="partition">\${prog(p.mount, dp, fmtB(p.used), fmtB(p.size))}</div>\`;
      }).join('');
      return \`<div class="disk">
        <div class="disk-header">
          <span class="disk-name">\${disk.name}</span>
          <span>\${disk.type ? tag(disk.type, 'cyan') : ''} \${disk.size ? tag(fmtB(disk.size), 'purple') : ''}</span>
        </div>\${pH}
      </div>\`;
    }).join('');
    cards.push(\`<div class="card w2">
      <div class="card-title">Armazenamento</div>\${dHtml}
    </div>\`);
  }

  if (d.gpu && d.gpu.length) {
    const gHtml = d.gpu.map(g => \`<div class="block">
      <div class="block-header">
        <span class="block-name">\${g.model}</span>
        \${g.vram ? tag(fmtB(g.vram * 1048576), 'cyan') : ''}
      </div>
      \${row('Fabricante', g.vendor)}
    </div>\`).join('');
    cards.push(\`<div class="card">
      <div class="card-title">GPU</div>\${gHtml}
    </div>\`);
  }

  if (d.displays && d.displays.length) {
    const mHtml = d.displays.map(m => \`<div class="block">
      <div class="block-header">
        <span class="block-name">\${m.name}</span>
        \${m.connection && m.connection !== '—' ? tag(m.connection, 'purple') : ''}
      </div>
      \${m.vendor && m.vendor !== '—' ? row('Fabricante', m.vendor) : ''}
      \${row('Resolução', m.resolution + (m.refresh ? ' @ ' + m.refresh + 'Hz' : ''), 'c-cyan')}
      \${m.serial ? row('Serial', m.serial) : ''}
    </div>\`).join('');
    cards.push(\`<div class="card">
      <div class="card-title">Monitores</div>\${mHtml}
    </div>\`);
  }

  if (d.network && d.network.length) {
    const nHtml = d.network.map(n => \`<div class="block">
      <div class="block-header">
        <span class="block-name">\${n.name || n.iface}</span>
        \${tag('Conectado', 'green')}
      </div>
      \${n.name ? row('Interface', n.iface) : ''}
      \${row('IP Local', n.ip4, 'c-cyan')}
      \${row('MAC', n.mac)}
      \${row('Tipo', n.type)}
      \${n.speed ? row('Velocidade', n.speed + ' Mbps') : ''}
    </div>\`).join('');
    cards.push(\`<div class="card">
      <div class="card-title">Rede</div>\${nHtml}
    </div>\`);
  }

  if (d.battery && d.battery.hasBattery) {
    const b = d.battery;
    cards.push(\`<div class="card">
      <div class="card-title">Bateria</div>
      \${prog('Carga', b.percent, b.percent + '%', '100%')}
      \${row('Status', b.isCharging ? 'Carregando' : 'Descarregando', b.isCharging ? 'c-green' : 'c-orange')}
      \${b.timeRemaining ? row('Tempo restante', b.timeRemaining + ' min') : ''}
    </div>\`);
  }

  const hasPrinters = d.printers && d.printers.length;
  const hasUsb      = d.usb && d.usb.length;
  if (hasPrinters || hasUsb) {
    let pH = '';
    if (hasPrinters) pH += \`<div class="sub">Impressoras</div>
      \${d.printers.map(p => row(p.name, tag(p.status, 'green'))).join('')}\`;
    if (hasUsb) pH += \`<div class="sub">USB Conectados</div>
      \${d.usb.map(u => row(u.name, u.type, 'c-comment')).join('')}\`;
    cards.push(\`<div class="card">
      <div class="card-title">Periféricos</div>\${pH}
    </div>\`);
  }

  document.getElementById('app').innerHTML = cards.join('');
}

// ─── countdown ───────────────────────────────────────────────────────────────
let secs = REFRESH;
const countEl = document.getElementById('countdown');
const fillEl  = document.getElementById('topbar-fill');

function startBar() {
  fillEl.style.transition = 'none';
  fillEl.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fillEl.style.transition = \`width \${REFRESH}s linear\`;
    fillEl.style.width = '0%';
  }));
}

function tick() {
  secs--;
  countEl.textContent = secs;
  if (secs <= 0) {
    secs = REFRESH;
    countEl.textContent = REFRESH;
    fetch('/api/data').then(r => r.json()).then(data => {
      render(data);
      startBar();
    }).catch(() => {});
  }
}

render(_d);
startBar();
setInterval(tick, 1000);

function exportCSV() { window.location.href = '/api/export.csv'; }
<\/script>
</body>
</html>`
}

// ─── servidor HTTP ────────────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "" "${url}"`
            : `xdg-open "${url}"`
  exec(cmd, err => { if (err) console.log(`  Abra no navegador: ${url}`) })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/data') {
      const data = await collectData()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify(data))
    }

    if (req.url === '/api/export.csv') {
      const data = await collectData()
      const csv  = toCSV(data)
      const name = `sysinfo_${new Date().toISOString().slice(0, 10)}.csv`
      res.writeHead(200, {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`
      })
      return res.end('﻿' + csv) // BOM → Excel reconhece UTF-8
    }

    const data = await collectData()
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(renderHTML(data))
  } catch (err) {
    console.error('Erro:', err)
    res.writeHead(500)
    res.end('Erro interno')
  }
})

const url = `http://localhost:${PORT}`

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  SysInfo Report`)
  console.log(`  Rodando em: ${url}`)
  console.log(`  Pressione Ctrl+C para encerrar.\n`)
  openBrowser(url)
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Erro: porta ${PORT} em uso. Tente: PORT=8080 node collectSystemInfo.js\n`)
  } else {
    console.error('Erro no servidor:', err)
  }
  process.exit(1)
})
