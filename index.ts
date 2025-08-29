import * as Automerge from "@automerge/automerge"

// AUTOMERGE SETUP ################################################################################

// Create canonical root document that all typewriter docs will fork from
const rootDoc = Automerge.change(Automerge.init<{ characters: string }>(), (doc) => {
  doc.characters = ""
})

// PAGE LAYOUT ####################################################################################

// Calculate the scale factor that'll get us to the output DPI we want
let charactersPerInch = 11 // this is based on the actual typewriter
let linesPerInch = 8 // ROUGHLY — this is based on the glyph scan Todd sent me
let atlasDPI = 1200 // ROUGHLY — this is based on the glyph scan Todd sent me
let outputDPI = 300 // You can change this to whatever value you want, and everything Just Works™
let scale = outputDPI / atlasDPI

// The width of the canvas
let lineWidth = 32 // this works out to A5 paper width

// These create empty space…
let margin = 6 // left and right — measure in character widths
let padding = 1 // on the top and bottom — measure in line heights

// ATLAS ###########################################################################################

// We assume that the provided glyph images will be an atlas of characters arranged in this pattern
// We also assume that the characters in this atlas have a single space between them
let atlasLayout = "!\"#$%_&'()*+ 1234567890-= QWERTYUIOP¼ qwertyuiop½ ASDFGHJKL:@ asdfghjkl;¢ ZXCVBNM,.? zxcvbnm,./".split(/\s/)

// Top left corner in atlas — just eyeball it
let sx = 75
let sy = 110

// Size of glyphs in the atlas
let gw = atlasDPI / charactersPerInch
let gh = atlasDPI / linesPerInch

// What's the default line height (ie: line height of "1"), relative to a glyph
let lh = gh * 1.5

// Shift the vertical alignment a bit so that it looks better
let verticalAlign = gh * 0.4

// How much extra space around the glyph should we include when copying the glyph from the atlas to the canvas?
// When this is zero, glyphs sometimes get cut off. If it's too big, you'll see bits of neighbouring glyphs.
let pad = gw * 0.4

// The atlases are slightly rotated, so this tries to compensate
let skew = 1.3

// This function returns the x,y pixel position within the atlas for a given character, or null if the character isn't in the atlas.
// The characters in the atlas have a single space between them, and the lines are double-spaced, so we multiply positions by 2 in both directions.
let getGlyphPosInAtlas = (c: string): [number, number] | [null, null] => {
  for (let [y, row] of atlasLayout.entries()) {
    let x = row.indexOf(c)
    if (x !== -1) {
      let px = sx + 2 * x * gw
      let py = sy + 2 * y * gh - x * skew // Compensate for the atlases being slightly tilted
      return [px, py]
    }
  }
  return [null, null]
}

// This image stores the currently-loaded glyph atlas
let atlasImg = new Image()
atlasImg.src = `glyphs/regular.png`

// TYPEWRITER #####################################################################################

class Typewriter {
  elm = document.createElement("canvas")
  ctx = this.elm.getContext("2d")!
  doc = Automerge.clone(rootDoc)
  previousDocState = this.doc
  insertionPoint = 0

  // Position to draw the next char
  cx = margin
  cy = padding

  // Insertion point position
  insertionX = margin * gw
  insertionY = padding * lh

  constructor(public left: number, public top: number) {
    this.elm.className = "text"
    this.elm.style.left = `${left}px`
    this.elm.style.top = `${top}px`
    document.body.appendChild(this.elm)

    // Add drag functionality
    this.elm.onmousedown = (e) => this.startDrag(e.clientX, e.clientY)

    // Register this typewriter
    allTypewriters.push(this)

    this.focus()
    this.startDrag(left, top)
  }

  startDrag(initialX: number, initialY: number) {
    let offsetX = this.left - initialX
    let offsetY = this.top - initialY
    this.focus()

    const onMouseMove = (e: MouseEvent) => {
      this.left = offsetX + e.clientX
      this.top = offsetY + e.clientY
      this.elm.style.left = `${this.left}px`
      this.elm.style.top = `${this.top}px`
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  focus() {
    let previousFocus = focusedInstance
    focusedInstance = this
    if (previousFocus && previousFocus !== this) previousFocus.render()
    this.render()
  }

  moveLeft() {
    if (this.insertionPoint > 0) {
      this.insertionPoint--
      this.render()
    }
  }

  moveRight() {
    if (this.insertionPoint < this.doc.characters.length) {
      this.insertionPoint++
      this.render()
    }
  }

  insertCharacter(char: string) {
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      doc.characters = doc.characters.slice(0, this.insertionPoint) + char + doc.characters.slice(this.insertionPoint)
    })
    this.insertionPoint++

    this.sendChangeToSyncServer()
    this.render()
  }

  deleteCharacter() {
    if (this.insertionPoint <= 0) return
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      doc.characters = doc.characters.slice(0, this.insertionPoint - 1) + doc.characters.slice(this.insertionPoint)
    })
    this.insertionPoint--

    this.sendChangeToSyncServer()
    this.render()
  }

  // Send change to sync server via particle
  sendChangeToSyncServer() {
    // Don't send if we ARE the sync server — that's handled elsewhere
    if (this instanceof SyncServer) return

    // Send to the closest sync server
    let syncServer: SyncServer | null = null
    let closeness = Infinity
    for (let ss of allSyncServers) {
      let dist = Math.hypot(this.left - ss.left, this.top - ss.top)
      if (dist < closeness) {
        syncServer = ss
        closeness = dist
      }
    }
    if (!syncServer) return

    const changes = this.getDocumentChanges()
    if (changes.length > 0) {
      particleManager.addChangeParticle(this, syncServer, changes)
      this.previousDocState = this.doc // Reset tracking after sending
    }
  }

  // Helper method to get changes since last tracked state
  getDocumentChanges() {
    return Automerge.getChanges(this.previousDocState, this.doc)
  }

  // Apply changes from another document (from particles)
  applyChanges(changes: Uint8Array[]) {
    this.previousDocState = this.doc
    const [newDoc] = Automerge.applyChanges(this.doc, changes)
    this.doc = newDoc
    this.render()
  }

  render() {
    // The width of the drawing canvas
    let w = gw * lineWidth

    // We first do a layout-only pass so we can measure the height of the canvas
    this.cx = margin // Reset the cursor position to the top left
    this.cy = padding
    this.drawAllText(false)
    let h = (this.cy + 1 + padding) * lh // Measure the height of the canvas

    // Before we resize the canvas, check if we're scrolled to the bottom.
    let oldHeight = this.elm.height

    // Now that we've got the width and height, we can resize the canvas (which also clears it)
    this.elm.width = w * scale
    this.elm.height = h * scale
    this.ctx.scale(scale, scale) // Have to set this every time we resize the canvas.

    if (oldHeight < this.elm.height) document.body.scrollBy({ top: this.elm.height - oldHeight })

    // The extra padding on chars means they overlap, so this allows them to overlap nicely
    this.ctx.globalCompositeOperation = "darken" // Have to set this every time we resize the canvas.

    // Improve visual centering
    this.ctx.translate(0, verticalAlign)

    // Draw all the chars
    this.cx = margin // Reset the cursor position to the top left (again)
    this.cy = padding
    this.drawAllText(true)

    // Draw insertion point only if this instance is focused
    if (focusedInstance === this) {
      this.ctx.fillStyle = `hsl(0, 70%, ${(Math.random() * 15 + 35) | 0}%)`
      this.ctx.beginPath()
      this.ctx.roundRect(this.insertionX + gw * 0.05, this.insertionY - lh * 0.2, gw * 0.15, gh * 1.4, gw * 0.05)
      this.ctx.fill()
    }
  }

  drawAllText(draw: boolean) {
    let charIndex = 0
    let characters = this.doc.characters

    for (let i = 0; i < characters.length; i++) {
      let char = characters[i]

      // Handle newlines
      if (char === "\n") {
        this.newline()
        charIndex++
        continue
      }

      // For spaces, just advance the cursor (and check if we need to wrap)
      if (char === " ") {
        if (this.cx >= lineWidth - margin) {
          this.newline()
        } else {
          this.cx++
        }
        charIndex++
        continue
      }

      // For non-space chars, check if the whole word fits on current line
      let wordEnd = i
      while (wordEnd < characters.length && characters[wordEnd] !== " " && characters[wordEnd] !== "\n") wordEnd++
      let wordLength = wordEnd - i

      // If word won't fit on current line, wrap to next line
      if (this.cx + wordLength > lineWidth - margin) this.newline()

      // Draw regular characters
      let [gx, gy] = getGlyphPosInAtlas(char)
      gx ??= 2257
      gy ??= 97

      // Draw the glyph
      if (draw) {
        let px = this.cx * gw
        let py = this.cy * lh
        this.ctx.drawImage(atlasImg, gx - pad, gy - pad, gw + pad * 2, gh + pad * 2, px - pad, py - pad, gw + pad * 2, gh + pad * 2)
      }

      this.cx++
      charIndex++

      // Check if this is where the insertion point should be
      if (draw && charIndex === this.insertionPoint) {
        this.insertionX = this.cx * gw
        this.insertionY = this.cy * lh
      }
    }

    // Check if insertion point is at the very end
    if (draw && charIndex === this.insertionPoint) {
      this.insertionX = this.cx * gw
      this.insertionY = this.cy * lh
    }
  }

  // Move cursor to beginning of next line
  newline() {
    this.cx = margin
    this.cy++
  }
}

// PARTICLE SYSTEM ##################################################################################

class Particle {
  angle = 0
  speed = 0
  progress = 0
  size = 8
  color = "hsl(300, 80%, 60%)"

  constructor(
    public changes: Uint8Array[],
    public source: Typewriter,
    public target: Typewriter,
    public x = 0,
    public y = 0,
    public targetX = 0,
    public targetY = 0
  ) {}

  update() {
    let dx = this.targetX - this.x
    let dy = this.targetY - this.y
    let angle = Math.atan2(dy, dx)
    let dist = Math.hypot(dx, dy)
    this.speed += Math.min(dist, 0.01)
    this.x += Math.cos(angle) * this.speed
    this.y += Math.sin(angle) * this.speed
    return dist < 1
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color
    ctx.beginPath()
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    ctx.fill()
  }
}

class ParticleManager {
  particles: Particle[] = []

  elm = document.createElement("canvas")
  ctx = this.elm.getContext("2d")!

  constructor() {
    this.elm.className = "particles"
    this.elm.width = window.innerWidth
    this.elm.height = window.innerHeight
    document.body.appendChild(this.elm)
  }

  // Add particle carrying changes
  addChangeParticle(source: Typewriter, target: Typewriter, changes: Uint8Array[]) {
    const startX = source.left
    const startY = source.top
    const targetX = target.left
    const targetY = target.top
    this.particles.push(new Particle(changes, source, target, startX, startY, targetX, targetY))
  }

  update() {
    // Collect completed particles first
    const completedParticles: Particle[] = []

    // Update all particles and remove completed ones
    this.particles = this.particles.filter((particle) => {
      const isComplete = particle.update()
      if (isComplete) completedParticles.push(particle)
      return !isComplete
    })

    // Process completed particles AFTER filtering is done
    completedParticles.forEach((particle) => {
      particle.target.applyChanges(particle.changes)

      // TODO: Can we only only rebroadcast to peers that don't already have this change?
      // Otherwise, 3 sync servers would generate an infinite loop A->B->C->A->B…
      if (particle.target instanceof SyncServer) {
        allTypewriters
          .filter((tw) => tw !== particle.target && tw !== particle.source)
          .forEach((typewriter) => particleManager.addChangeParticle(particle.target, typewriter, particle.changes))
      }
    })

    // Render particles
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    this.particles.forEach((particle) => particle.draw(this.ctx))
  }
}

// Global particle manager
const particleManager = new ParticleManager()
const animate = () => {
  particleManager.update()
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

// SYNC SERVER CLASS ################################################################################

class SyncServer extends Typewriter {
  constructor(x: number, y: number) {
    super(x, y)
    allSyncServers.push(this)
    this.elm.classList.add("server")
  }
}

// INSTANCE MANAGEMENT ##############################################################################

let focusedInstance: Typewriter | null = null
let allTypewriters: Typewriter[] = []
let allSyncServers: SyncServer[] = []

// Spawn new typewriter by dragging from the top-left corner
window.addEventListener("mousedown", (e) => {
  if (e.clientX <= 50 && e.clientY <= 50) new Typewriter(e.clientX, e.clientY)
  if (e.clientX >= window.innerWidth - 50 && e.clientY <= 50) new SyncServer(e.clientX, e.clientY)
})

// Handle typing input
window.addEventListener("keydown", (e) => {
  if (!focusedInstance) return
  if (e.key.length === 1) return focusedInstance.insertCharacter(e.key)
  if (e.key === "Enter") return focusedInstance.insertCharacter("\n")
  if (e.key === "Backspace") return focusedInstance.deleteCharacter()
  if (e.key === "ArrowLeft") return focusedInstance.moveLeft()
  if (e.key === "ArrowRight") return focusedInstance.moveRight()
  e.preventDefault()
})
