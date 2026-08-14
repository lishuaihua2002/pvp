import Phaser from 'phaser'
import type { FighterManifest } from '../../types/fighter'
import type { CombatInput, StateSnapshot } from '../../types/combat'
import { ANIMATIONS, samplePose } from '../config/animations'
import {
  ARENA_WIDTH,
  EMPTY_INPUT,
  GROUND_Y,
  createSimState,
  stepSim,
  type SimState,
} from '../combat/sim'
import { SkeletalFighter } from '../entities/SkeletalFighter'
import { KeyboardInput } from '../input/keyboard'
import { playSfx } from '../audio/sfx'
import type { MatchChannel } from '../networking/matchChannel'

export interface ArenaConfig {
  mode: 'local' | 'online' | 'preview'
  localPlayerId: string
  remotePlayerId: string
  localFighter: FighterManifest
  remoteFighter: FighterManifest
  localName: string
  remoteName: string
  /** local player is on the left / is host */
  isHost: boolean
  channel?: MatchChannel
  onExit?: (reason: 'self' | 'opponent' | 'disconnect') => void
  onPing?: (ms: number) => void
  onActiveStart?: () => void
}

const ARENA_HEIGHT = 720
const SNAPSHOT_INTERVAL = 12
const SIM_DT = 1000 / 60

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaConfig
  private sim!: SimState
  private fighters = new Map<string, SkeletalFighter>()
  readonly keyboard = new KeyboardInput()
  private accumulator = 0
  private hitstop = 0
  private phase: 'loading' | 'entrance' | 'ready' | 'fight' | 'active' | 'ended' = 'loading'
  private phaseTimer = 0
  private bannerText!: Phaser.GameObjects.Text
  private remoteInput: CombatInput = { ...EMPTY_INPUT }
  private lastSentInput = ''
  private pendingSnapshot: StateSnapshot | null = null
  private particles!: Phaser.GameObjects.Particles.ParticleEmitter
  private dustParticles!: Phaser.GameObjects.Particles.ParticleEmitter
  private opponentGone = false
  private pingTimer?: Phaser.Time.TimerEvent
  private prevActions: Record<string, string> = {}

  constructor() {
    super('ArenaScene')
  }

  init(cfg: ArenaConfig) {
    this.cfg = cfg
    this.fighters.clear()
    this.accumulator = 0
    this.hitstop = 0
    this.phase = 'loading'
    this.phaseTimer = 0
    this.remoteInput = { ...EMPTY_INPUT }
    this.opponentGone = false
    this.prevActions = {}
  }

  create() {
    const cfg = this.cfg
    this.cameras.main.setBackgroundColor('#141126')

    // background layers
    const g = this.add.graphics()
    g.fillStyle(0x1d1837, 1)
    g.fillRect(0, 0, ARENA_WIDTH, GROUND_Y)
    g.fillStyle(0x272052, 1)
    for (let i = 0; i < 8; i++) {
      const w = 90 + ((i * 53) % 70)
      const h = 180 + ((i * 97) % 220)
      g.fillRect(60 + i * 150, GROUND_Y - h, w, h)
    }
    g.fillStyle(0x0b0917, 1)
    g.fillRect(0, GROUND_Y, ARENA_WIDTH, ARENA_HEIGHT - GROUND_Y)
    g.fillStyle(0x332b66, 1)
    g.fillRect(0, GROUND_Y, ARENA_WIDTH, 6)

    // particle textures
    if (!this.textures.exists('spark')) {
      const c = this.textures.createCanvas('spark', 12, 12)!
      const ctx = c.getContext()
      ctx.fillStyle = '#ffd23e'
      ctx.beginPath()
      ctx.arc(6, 6, 5, 0, Math.PI * 2)
      ctx.fill()
      c.refresh()
    }
    if (!this.textures.exists('dust')) {
      const c = this.textures.createCanvas('dust', 10, 10)!
      const ctx = c.getContext()
      ctx.fillStyle = 'rgba(200,190,230,0.8)'
      ctx.beginPath()
      ctx.arc(5, 5, 4, 0, Math.PI * 2)
      ctx.fill()
      c.refresh()
    }
    this.particles = this.add.particles(0, 0, 'spark', {
      speed: { min: 120, max: 360 },
      scale: { start: 1.2, end: 0 },
      lifespan: 300,
      emitting: false,
    })
    this.dustParticles = this.add.particles(0, 0, 'dust', {
      speed: { min: 30, max: 110 },
      angle: { min: 200, max: 340 },
      scale: { start: 1, end: 0 },
      lifespan: 400,
      emitting: false,
    })

    this.bannerText = this.add
      .text(ARENA_WIDTH / 2, 260, '', {
        fontSize: '96px',
        fontStyle: 'bold',
        color: '#ffd23e',
        stroke: '#1a1020',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(10)

    // shadows
    const shadow = this.add.graphics().setDepth(1)
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      shadow.clear()
      shadow.fillStyle(0x000000, 0.35)
      for (const p of this.sim?.players ?? []) {
        shadow.fillEllipse(p.x, GROUND_Y + 8, 90, 18)
      }
    })

    const leftId = cfg.isHost ? cfg.localPlayerId : cfg.remotePlayerId
    const rightId = cfg.isHost ? cfg.remotePlayerId : cfg.localPlayerId
    this.sim = createSimState(leftId, rightId)

    // name labels
    this.add
      .text(30, 24, cfg.isHost ? cfg.localName : cfg.remoteName, { fontSize: '26px', fontStyle: 'bold', color: '#3edcff' })
      .setDepth(10)
    this.add
      .text(ARENA_WIDTH - 30, 24, cfg.isHost ? cfg.remoteName : cfg.localName, { fontSize: '26px', fontStyle: 'bold', color: '#ff3e6c' })
      .setOrigin(1, 0)
      .setDepth(10)

    void this.loadFighters()

    this.keyboard.attach()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyboard.detach()
      this.pingTimer?.remove()
    })

    if (cfg.mode === 'online' && cfg.channel) {
      this.setupNetwork()
    }
  }

  private async loadFighters() {
    const cfg = this.cfg
    try {
      await SkeletalFighter.loadTextures(this, cfg.localFighter)
      await SkeletalFighter.loadTextures(this, cfg.remoteFighter)
    } catch (e) {
      this.bannerText.setText('资源加载失败').setFontSize(48)
      console.error(e)
      return
    }
    const leftIsLocal = cfg.isHost
    const leftManifest = leftIsLocal ? cfg.localFighter : cfg.remoteFighter
    const rightManifest = leftIsLocal ? cfg.remoteFighter : cfg.localFighter
    const [pl, pr] = this.sim.players
    // start offscreen for entrance walk-in
    const fl = new SkeletalFighter(this, leftManifest, -80, GROUND_Y)
    const fr = new SkeletalFighter(this, rightManifest, ARENA_WIDTH + 80, GROUND_Y)
    fl.container.setDepth(5)
    fr.container.setDepth(5)
    this.fighters.set(pl.playerId, fl)
    this.fighters.set(pr.playerId, fr)

    if (this.cfg.mode === 'online' && this.cfg.channel) {
      this.cfg.channel.send('assets_loaded', {})
      this.phase = 'loading'
      this.bannerText.setText('等待对手...').setFontSize(44)
      this.selfLoaded = true
      this.tryStartCountdown()
    } else {
      this.beginEntrance()
    }
  }

  private selfLoaded = false
  private remoteLoaded = false
  private countdownStarted = false

  private tryStartCountdown() {
    if (this.countdownStarted) return
    if (!(this.selfLoaded && this.remoteLoaded)) return
    this.countdownStarted = true
    if (this.cfg.isHost) {
      this.cfg.channel?.send('countdown_start', { startAt: Date.now() + 500 })
      this.time.delayedCall(500, () => this.beginEntrance())
    }
  }

  private setupNetwork() {
    const ch = this.cfg.channel!
    ch.setHandlers({
      onInput: (_pid: string, input: CombatInput) => {
        this.remoteInput = input
      },
      onSnapshot: (snap: StateSnapshot) => {
        if (!this.cfg.isHost) this.pendingSnapshot = snap
      },
      onPlayerExit: () => this.endMatch('opponent'),
      onPresenceLeave: () => {
        this.opponentGone = true
        this.time.delayedCall(5000, () => {
          if (this.opponentGone && this.phase !== 'ended') this.endMatch('disconnect')
        })
      },
      onPresenceJoin: () => {
        this.opponentGone = false
      },
      onAssetsLoaded: () => {
        this.remoteLoaded = true
        this.tryStartCountdown()
      },
      onCountdownStart: (startAt: number) => {
        if (!this.cfg.isHost) {
          const delay = Math.max(0, startAt - Date.now())
          this.time.delayedCall(delay, () => this.beginEntrance())
        }
      },
      onPing: (_from: string, t: number) => {
        ch.send('pong', { t })
      },
      onPong: (t: number) => {
        this.cfg.onPing?.(Date.now() - t)
      },
    })
    this.pingTimer = this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => ch.send('ping', { t: Date.now() }),
    })
  }

  private beginEntrance() {
    if (this.phase !== 'loading') return
    this.phase = 'entrance'
    this.phaseTimer = 0
    playSfx('entrance')
    for (const p of this.sim.players) {
      p.action = 'entrance'
      p.actionFrame = 0
    }
  }

  private endMatch(reason: 'self' | 'opponent' | 'disconnect') {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    playSfx('exit')
    if (reason === 'self') this.cfg.channel?.send('player_exit', {})
    this.cfg.onExit?.(reason)
  }

  /** called from React exit button */
  requestExit() {
    this.endMatch('self')
  }

  update(_time: number, delta: number) {
    if (!this.sim || this.fighters.size < 2) return
    if (this.phase === 'ended' || this.phase === 'loading') {
      this.renderFighters()
      return
    }

    // entrance sequencing
    if (this.phase === 'entrance') {
      this.phaseTimer += delta
      const targetL = ARENA_WIDTH * 0.3
      const targetR = ARENA_WIDTH * 0.7
      const t = Math.min(1, this.phaseTimer / 1800)
      const [pl, pr] = this.sim.players
      pl.x = Phaser.Math.Linear(-80, targetL, t)
      pr.x = Phaser.Math.Linear(ARENA_WIDTH + 80, targetR, t)
      pl.actionFrame = Math.min(pl.actionFrame + 1, ANIMATIONS.entrance.durationFrames)
      pr.actionFrame = Math.min(pr.actionFrame + 1, ANIMATIONS.entrance.durationFrames)
      if (t >= 1) {
        this.phase = 'ready'
        this.phaseTimer = 0
        this.bannerText.setText('READY').setFontSize(96)
        playSfx('ready')
      }
      this.renderFighters()
      return
    }
    if (this.phase === 'ready') {
      this.phaseTimer += delta
      if (this.phaseTimer > 900) {
        this.phase = 'fight'
        this.phaseTimer = 0
        this.bannerText.setText('FIGHT!')
        playSfx('fight')
      }
      this.renderFighters()
      return
    }
    if (this.phase === 'fight') {
      this.phaseTimer += delta
      if (this.phaseTimer > 700) {
        this.bannerText.setText('')
        this.phase = 'active'
        for (const p of this.sim.players) {
          p.action = 'idle'
          p.actionFrame = 0
        }
        this.cfg.onActiveStart?.()
      }
      this.renderFighters()
      return
    }

    // === active fight ===
    if (this.hitstop > 0) {
      this.hitstop -= delta
      this.renderFighters()
      return
    }

    this.accumulator += delta
    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT
      this.simStep()
    }

    // non-host snapshot correction
    if (this.pendingSnapshot && !this.cfg.isHost) {
      const snap = this.pendingSnapshot
      this.pendingSnapshot = null
      for (const sp of snap.players) {
        const local = this.sim.players.find((p) => p.playerId === sp.playerId)
        if (!local) continue
        const dist = Math.abs(local.x - sp.x) + Math.abs(local.y - sp.y)
        if (sp.playerId === this.cfg.localPlayerId && dist < 40) continue // trust local prediction for self
        if (dist > 120) {
          Object.assign(local, sp)
        } else {
          local.x = Phaser.Math.Linear(local.x, sp.x, 0.35)
          local.y = Phaser.Math.Linear(local.y, sp.y, 0.35)
          local.vx = sp.vx
          local.vy = sp.vy
          if (local.action !== sp.action && sp.playerId !== this.cfg.localPlayerId) {
            local.action = sp.action
            local.actionFrame = sp.actionFrame
            local.facing = sp.facing
          }
          local.impact = sp.impact
          local.hitstun = sp.hitstun
        }
      }
    }

    this.renderFighters()
  }

  private simStep() {
    const cfg = this.cfg
    const frame = this.sim.frame
    const localInput = this.keyboard.sample(frame)

    let inputA: CombatInput
    let inputB: CombatInput
    if (cfg.mode === 'local' || cfg.mode === 'preview') {
      inputA = localInput
      inputB = this.sampleLocalP2(frame)
    } else {
      // online: player A is host-side (left)
      const remote = { ...this.remoteInput, frame }
      inputA = cfg.isHost ? localInput : remote
      inputB = cfg.isHost ? remote : localInput
      // send our input when changed or as heartbeat
      const enc = JSON.stringify([localInput.left, localInput.right, localInput.jump, localInput.punch, localInput.kick])
      if (enc !== this.lastSentInput || frame % 6 === 0 || localInput.jump || localInput.punch || localInput.kick) {
        this.lastSentInput = enc
        cfg.channel?.send('input', localInput)
      }
      // host broadcasts snapshots
      if (cfg.isHost && frame % SNAPSHOT_INTERVAL === 0) {
        cfg.channel?.send('state_snapshot', {
          frame,
          players: this.sim.players.map((p) => ({ ...p })),
        })
      }
    }

    const prevAirborne = this.sim.players.map((p) => !p.onGround)
    const events = stepSim(this.sim, inputA, inputB)

    // sfx for whiffs/jumps/landings
    this.sim.players.forEach((p, i) => {
      const prev = this.prevActions[p.playerId]
      if (p.action !== prev) {
        if (p.action === 'punch') playSfx('punch_whiff')
        if (p.action === 'kick') playSfx('kick_whiff')
        if (p.action === 'jump') playSfx('jump')
        if (p.action === 'knockdown') playSfx('knockdown')
        this.prevActions[p.playerId] = p.action
      }
      if (prevAirborne[i] && p.onGround) {
        playSfx('land')
        this.dustParticles.emitParticleAt(p.x, GROUND_Y, 8)
      }
    })

    for (const ev of events) {
      this.onHit(ev.kind, ev.x, ev.y, ev.knockdown, ev.defenderId)
    }
  }

  /** local mode: P2 controlled by arrow keys + '1' punch '2' kick (for same-browser testing) */
  private p2held = new Set<string>()
  private p2buffer = { jump: false, punch: false, kick: false }
  private p2seq = 0
  private p2Attached = false

  private sampleLocalP2(frame: number): CombatInput {
    if (!this.p2Attached) {
      this.p2Attached = true
      window.addEventListener('keydown', (e) => {
        const k = e.key
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', '1', '2'].includes(k)) e.preventDefault()
        if (!this.p2held.has(k)) {
          if (k === 'ArrowUp') this.p2buffer.jump = true
          if (k === '1') this.p2buffer.punch = true
          if (k === '2') this.p2buffer.kick = true
        }
        this.p2held.add(k)
      })
      window.addEventListener('keyup', (e) => this.p2held.delete(e.key))
    }
    const input: CombatInput = {
      frame,
      seq: ++this.p2seq,
      left: this.p2held.has('ArrowLeft'),
      right: this.p2held.has('ArrowRight'),
      jump: this.p2buffer.jump,
      punch: this.p2buffer.punch,
      kick: this.p2buffer.kick,
    }
    this.p2buffer = { jump: false, punch: false, kick: false }
    return input
  }

  private onHit(kind: 'punch' | 'kick', x: number, y: number, _knockdown: boolean, defenderId: string) {
    this.hitstop = kind === 'punch' ? 55 : 80
    this.cameras.main.shake(kind === 'punch' ? 90 : 140, kind === 'punch' ? 0.004 : 0.008)
    this.particles.emitParticleAt(x, y, kind === 'punch' ? 10 : 18)
    playSfx(kind === 'punch' ? 'punch_hit' : 'kick_hit')
    playSfx('hurt')
    this.fighters.get(defenderId)?.flash(6)
  }

  private renderFighters() {
    for (const p of this.sim.players) {
      const f = this.fighters.get(p.playerId)
      if (!f) continue
      f.setPosition(p.x, p.y)
      const anim = ANIMATIONS[p.action]
      const pose = samplePose(anim, anim.loop ? p.actionFrame % anim.durationFrames : p.actionFrame)
      f.applyPose(pose, p.facing)
    }
    // camera framing
    const [a, b] = this.sim.players
    const mid = (a.x + b.x) / 2
    const dist = Math.abs(a.x - b.x)
    const zoom = Phaser.Math.Clamp(1.25 - dist / 2400, 0.95, 1.15)
    const cam = this.cameras.main
    cam.setZoom(Phaser.Math.Linear(cam.zoom, zoom, 0.05))
    const targetX = Phaser.Math.Clamp(mid, ARENA_WIDTH * 0.35, ARENA_WIDTH * 0.65)
    cam.centerOnX(Phaser.Math.Linear(cam.midPoint.x, targetX, 0.08))
    cam.centerOnY(ARENA_HEIGHT / 2 + 60)
  }
}

export const ARENA_DIMENSIONS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
