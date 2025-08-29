import * as Automerge from "@automerge/automerge"
const TAU = Math.PI * 2

// keep i between min and max
const clip = (i: number, min = 0, max = 1) => Math.min(Math.max(i, min), max)

// get what i would be if min became 0 and max became 1
const normalized = (i: number, min: number, max: number, doClip = false) => {
  let n = max === min ? min : (i - min) / (max - min)
  return doClip ? clip(n) : n
}

// get what i would be if 0 became min and 1 became max
const denormalized = (i: number, min: number, max: number) => i * (max - min) + min

// normalize to [min1,max1] then denormalize to [min2,max2]
const renormalized = (i: number, min1: number, max1: number, min2: number, max2: number, doClip = false) => {
  if (max1 < min1) [min1, max1] = [max1, min1]
  let n = normalized(i, min1, max1, doClip)
  return denormalized(n, min2, max2)
}

// GLOBAL CANVASES FOR LAYERS #######################################################################

const dpr = window.devicePixelRatio || 1

// Underlay canvas for connection lines (behind typewriters)
const underlayCanvas = document.createElement("canvas")
const underlayCtx = underlayCanvas.getContext("2d")!
underlayCanvas.className = "canvas-layer underlay"
underlayCanvas.width = window.innerWidth * dpr
underlayCanvas.height = window.innerHeight * dpr
underlayCtx.scale(dpr, dpr)
document.body.appendChild(underlayCanvas)

// Overlay canvas for particles (above typewriters)
const overlayCanvas = document.createElement("canvas")
const overlayCtx = overlayCanvas.getContext("2d")!
overlayCanvas.className = "canvas-layer overlay"
overlayCanvas.width = window.innerWidth * dpr
overlayCanvas.height = window.innerHeight * dpr
overlayCtx.scale(dpr, dpr)
document.body.appendChild(overlayCanvas)

// TYPES ###########################################################################################

type Position = { x: number; y: number }

// GEOMETRY HELPERS ################################################################################

// Calculate typewriter dimensions based on layout constants
function getTypewriterDimensions(typewriter: Typewriter) {
  // Calculate width and height based on text content and layout
  typewriter.drawAllText(false) // Do layout pass to get dimensions
  const width = lineWidth * gw * scale
  const height = (typewriter.cy + 1 + padding) * lh * scale
  return { width, height }
}

// Calculate edge-to-edge distance between two typewriters
function getEdgeDistance(tw1: Typewriter, tw2: Typewriter): number {
  const dims1 = getTypewriterDimensions(tw1)
  const dims2 = getTypewriterDimensions(tw2)
  
  const centerToCenter = {
    x: tw1.left + dims1.width / 2 - (tw2.left + dims2.width / 2),
    y: tw1.top + dims1.height / 2 - (tw2.top + dims2.height / 2)
  }
  
  return Math.hypot(
    Math.max(0, Math.abs(centerToCenter.x) - dims1.width / 2 - dims2.width / 2),
    Math.max(0, Math.abs(centerToCenter.y) - dims1.height / 2 - dims2.height / 2)
  )
}

// AUTOMERGE SETUP ################################################################################

// Create canonical root document that all typewriter docs will fork from
const rootDoc = Automerge.change(Automerge.init<{ text: string }>(), (doc) => {
  doc.text = ""
})

// SYNC CONFIGURATION ##############################################################################

const SYNC_RANGE = 200 // Distance in pixels for server-to-server communication

// PAGE LAYOUT ####################################################################################

// Calculate the scale factor that'll get us to the output DPI we want
let charactersPerInch = 11 // this is based on the actual typewriter
let linesPerInch = 8 // ROUGHLY — this is based on the glyph scan Todd sent me
let atlasDPI = 1200 // ROUGHLY — this is based on the glyph scan Todd sent me
let outputDPI = 300 // You can change this to whatever value you want, and everything Just Works™
let scale = (0.5 * outputDPI) / atlasDPI

// The width of the canvas
let lineWidth = 32 // this works out to A5 paper width

// These create empty space…
let margin = 2 // left and right — measure in character widths
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
  speculativeDoc = this.doc
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
    this.elm.onmousedown = (e) => {
      e.preventDefault()
      this.startDrag(e.clientX, e.clientY)
    }

    // Register this typewriter
    allTypewriters.push(this)

    this.focus()
    this.startDrag(left, top)
    this.render()
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
    if (this.insertionPoint < this.doc.text.length) {
      this.insertionPoint++
      this.render()
    }
  }

  insertCharacter(char: string) {
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      Automerge.splice(doc, ["text"], this.insertionPoint, 0, char)
    })
    this.insertionPoint++

    this.sendChangeToSyncServer()
    this.render()
  }

  deleteCharacter() {
    if (this.insertionPoint <= 0) return
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      Automerge.splice(doc, ["text"], this.insertionPoint - 1, 1)
    })
    this.insertionPoint--

    this.sendChangeToSyncServer()
    this.render()
  }

  // Send change to sync server via particle
  sendChangeToSyncServer() {
    // Don't send if we ARE the sync server — that's handled elsewhere
    if (this instanceof SyncServer) return

    // Send to the closest sync server within range
    let syncServer: SyncServer | null = null
    let closeness = Infinity
    for (let ss of allSyncServers) {
      let dist = getEdgeDistance(this, ss)
      if (dist <= SYNC_RANGE && dist < closeness) {
        syncServer = ss
        closeness = dist
      }
    }
    if (!syncServer) return // No server within range

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

  // Convert grid position to screen coordinates
  gridToScreenCoords(gridX: number, gridY: number): Position {
    const screenX = this.left + (gridX * gw + gw / 2) * scale
    const screenY = this.top + (gridY * lh + gh / 2) * scale
    return { x: screenX, y: screenY }
  }

  // Calculate where changes will be applied and return screen coordinates
  calculateChangeTargetPosition(changes: Uint8Array[]): Position {
    // Speculatively apply changes to a clone to get the after state
    const [afterDoc] = Automerge.applyChanges(Automerge.clone(this.doc), changes)

    const beforeChars = this.doc.text
    const afterChars = afterDoc.text

    // Find the first difference between before and after
    let changeIndex = 0
    const minLength = Math.min(beforeChars.length, afterChars.length)

    // Find first differing position
    for (let i = 0; i < minLength; i++) {
      if (beforeChars[i] !== afterChars[i]) {
        changeIndex = i
        break
      }
    }

    // If no differences found in common length, change is at the end of shorter string
    if (changeIndex === 0 && beforeChars.length !== afterChars.length) {
      changeIndex = minLength
    }

    // Get grid position at the change index
    const gridPos = this.drawAllText(false, changeIndex)
    if (!gridPos) {
      // Fallback to current position if drawAllText doesn't return position
      return { x: this.left, y: this.top }
    }

    return this.gridToScreenCoords(gridPos.cx, gridPos.cy)
  }

  // Calculate where changes will be applied using speculative doc state
  calculateChangeTargetPositionSpeculative(changes: Uint8Array[]): { position: Position; character: string; color: string } {
    // Apply changes to the current speculative state to get the after state
    const [afterDoc] = Automerge.applyChanges(Automerge.clone(this.speculativeDoc), changes)

    const beforeChars = this.speculativeDoc.text
    const afterChars = afterDoc.text

    // Find the first difference between before and after
    let changeIndex = 0
    const minLength = Math.min(beforeChars.length, afterChars.length)

    // Find first differing position
    for (let i = 0; i < minLength; i++) {
      if (beforeChars[i] !== afterChars[i]) {
        changeIndex = i
        break
      }
    }

    // If no differences found in common length, change is at the end of shorter string
    if (changeIndex === 0 && beforeChars.length !== afterChars.length) {
      changeIndex = minLength
    }

    // Determine character and color
    const isAddition = afterChars.length > beforeChars.length
    let character: string
    let color: string

    if (isAddition) {
      character = afterChars[changeIndex] || ""
      color = "green"
    } else {
      character = beforeChars[changeIndex] || ""
      color = "red"
    }

    // Handle special characters
    if (character === "\n") {
      character = "\\n"
    } else if (character === " ") {
      character = "" // Empty string for spaces - will draw as blank
    }

    // Create a temporary typewriter with speculative doc for layout calculation
    const tempTypewriter = Object.create(this)
    tempTypewriter.doc = this.speculativeDoc

    // Get grid position at the change index using the speculative doc
    const gridPos = tempTypewriter.drawAllText(false, changeIndex)
    if (!gridPos) {
      // Fallback to current position if drawAllText doesn't return position
      return { position: { x: this.left, y: this.top }, character, color }
    }

    return { position: this.gridToScreenCoords(gridPos.cx, gridPos.cy), character, color }
  }

  render() {
    // The width of the drawing canvas
    let w = gw * lineWidth

    // We first do a layout-only pass so we can measure the height of the canvas
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
    this.drawAllText(true)

    // Draw insertion point only if this instance is focused
    if (focusedInstance === this) {
      this.ctx.fillStyle = `hsl(0, 70%, ${(Math.random() * 15 + 35) | 0}%)`
      this.ctx.beginPath()
      let w = gw * 0.15
      this.ctx.roundRect(this.insertionX - w / 2, this.insertionY - lh * 0.2, w, gh * 1.4, gw * 0.05)
      this.ctx.fill()
    }
  }

  drawAllText(draw: boolean, stopAtCharIndex?: number): { cx: number; cy: number } | void {
    this.cx = margin // Reset the cursor position to the top left
    this.cy = padding

    let characters = this.doc.text
    if (draw) this.insertionPoint = Math.min(this.insertionPoint, characters.length)
    let charIndex = 0

    for (; charIndex < characters.length; charIndex++) {
      // Check if we should stop at this character index
      if (stopAtCharIndex !== undefined && charIndex >= stopAtCharIndex) {
        return { cx: this.cx, cy: this.cy }
      }

      // Check if this is where the insertion point should be
      if (draw && charIndex === this.insertionPoint) {
        this.insertionX = this.cx * gw
        this.insertionY = this.cy * lh
      }

      let char = characters[charIndex]

      // Handle newlines
      if (char === "\n") {
        this.newline()
        continue
      }

      // For spaces, just advance the cursor (and check if we need to wrap)
      if (char === " ") {
        if (this.cx >= lineWidth - margin) {
          this.newline()
        } else {
          this.cx++
        }
        continue
      }

      // For non-space chars, check if the whole word fits on current line
      let wordEnd = charIndex
      while (wordEnd < characters.length && characters[wordEnd] !== " " && characters[wordEnd] !== "\n") wordEnd++
      let wordLength = wordEnd - charIndex

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
    }

    // Check if insertion point is at the very end
    if (draw && charIndex === this.insertionPoint) {
      this.insertionX = this.cx * gw
      this.insertionY = this.cy * lh
    }

    // If we have a stopAtCharIndex and reached the end, return final position
    if (stopAtCharIndex !== undefined && charIndex >= stopAtCharIndex) {
      return { cx: this.cx, cy: this.cy }
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
  position: Position
  lastKnownDistance = Infinity
  character: string = ""
  color: string = "#000"

  constructor(public changes: Uint8Array[], public source: Typewriter, public target: Typewriter) {
    this.position = source.gridToScreenCoords(source.insertionX / gw, source.insertionY / lh)
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.character === "") {
      // Draw blank circle for spaces
      ctx.strokeStyle = this.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(this.position.x, this.position.y, 8, 0, TAU)
      ctx.stroke()
    } else {
      // Draw character with background circle
      ctx.fillStyle = this.color
      ctx.beginPath()
      ctx.arc(this.position.x, this.position.y, 12, 0, TAU)
      ctx.fill()

      // Draw character text
      ctx.fillStyle = "white"
      ctx.font = "14px monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(this.character, this.position.x, this.position.y)
    }
  }
}

class ParticleManager {
  particles: Particle[] = []

  // Add particle carrying changes
  addChangeParticle(source: Typewriter, target: Typewriter, changes: Uint8Array[]) {
    this.particles.push(new Particle(changes, source, target))
  }

  update() {
    // Reset all speculative docs to their base state
    allTypewriters.forEach((tw) => (tw.speculativeDoc = Automerge.clone(tw.doc)))

    this.particles.sort((a, b) => a.lastKnownDistance - b.lastKnownDistance)

    // Update particles in arrival order, maintaining speculative state
    const completedParticles: Particle[] = []
    const remainingParticles: Particle[] = []

    this.particles.forEach((particle) => {
      // Update particle target based on current speculative state
      const targetInfo = particle.target.calculateChangeTargetPositionSpeculative(particle.changes)

      // Update particle character and color
      particle.character = targetInfo.character
      particle.color = targetInfo.color

      // Update particle movement toward the (potentially updated) target
      let dx = targetInfo.position.x - particle.position.x
      let dy = targetInfo.position.y - particle.position.y
      particle.position.x += dx / 50
      particle.position.y += dy / 50

      dx = targetInfo.position.x - particle.position.x
      dy = targetInfo.position.y - particle.position.y
      const dist = Math.hypot(dx, dy)
      particle.lastKnownDistance = dist

      // Apply this particle's changes to the target's speculative doc for subsequent particles
      const [newSpeculativeDoc] = Automerge.applyChanges(particle.target.speculativeDoc, particle.changes)
      particle.target.speculativeDoc = newSpeculativeDoc

      if (dist < 10) completedParticles.push(particle)
      else remainingParticles.push(particle)
    })

    this.particles = remainingParticles

    // Process completed particles AFTER filtering is done
    completedParticles.forEach((particle) => {
      particle.target.applyChanges(particle.changes)

      // Rebroadcast logic for sync servers
      if (particle.target instanceof SyncServer) {
        // Send to nearby sync servers
        allSyncServers
          .filter((server) => server !== particle.target && server !== particle.source)
          .forEach((server) => {
            const dist = getEdgeDistance(particle.target, server)
            if (dist <= SYNC_RANGE) {
              particleManager.addChangeParticle(particle.target, server, particle.changes)
            }
          })

        // Send to regular typewriters (clients of this server)
        allTypewriters
          .filter((tw) => !(tw instanceof SyncServer) && tw !== particle.source)
          .forEach((typewriter) => {
            // Send to typewriters that consider this server their closest server within range
            let closestServer: SyncServer | null = null
            let closeness = Infinity
            for (let ss of allSyncServers) {
              let dist = getEdgeDistance(typewriter, ss)
              if (dist <= SYNC_RANGE && dist < closeness) {
                closestServer = ss
                closeness = dist
              }
            }
            if (closestServer === particle.target) {
              particleManager.addChangeParticle(particle.target, typewriter, particle.changes)
            }
          })
      }
    })

    // Clear and render underlay content (connection lines)
    underlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    // Render sync server connections on underlay
    allSyncServers.forEach((server) => {
      underlayCtx.lineWidth = 3

      // Get server rectangle
      const serverDims = getTypewriterDimensions(server)
      const serverRect = {
        left: server.left,
        top: server.top,
        width: serverDims.width,
        height: serverDims.height,
      }

      // Draw lines to all typewriters in range
      allTypewriters.forEach((typewriter) => {
        if (typewriter === server) return // Don't draw line to self

        // Get typewriter rectangle
        const typewriterDims = getTypewriterDimensions(typewriter)
        const typewriterRect = {
          left: typewriter.left,
          top: typewriter.top,
          width: typewriterDims.width,
          height: typewriterDims.height,
        }

        // Check distance between rectangle edges
        const edgeDist = getEdgeDistance(server, typewriter)

        if (edgeDist <= SYNC_RANGE) {
          // Calculate fade: 1.0 at 0-200px, fade to 0.1 from 200-400px
          const alpha = renormalized(edgeDist, SYNC_RANGE * 0.5, SYNC_RANGE, 0.5, 0.1, true)

          // Draw line between centers with fade
          const serverCenter = { x: serverRect.left + serverRect.width / 2, y: serverRect.top + serverRect.height / 2 }
          const typewriterCenter = { x: typewriterRect.left + typewriterRect.width / 2, y: typewriterRect.top + typewriterRect.height / 2 }

          underlayCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
          underlayCtx.beginPath()
          underlayCtx.moveTo(serverCenter.x, serverCenter.y)
          underlayCtx.lineTo(typewriterCenter.x, typewriterCenter.y)
          underlayCtx.stroke()
        }
      })
    })

    // Clear and render overlay content (particles)
    overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    this.particles.forEach((particle) => particle.draw(overlayCtx))
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

  // Override render (sync range circle now drawn by particle manager)
  render() {
    super.render()
  }

  // Send changes to other sync servers within range
  sendChangeToOtherServers() {
    const changes = this.getDocumentChanges()
    if (changes.length === 0) return

    // Send to nearby sync servers within range
    allSyncServers.forEach((server) => {
      if (server === this) return // Don't send to self

      const dist = getEdgeDistance(this, server)
      if (dist <= SYNC_RANGE) {
        particleManager.addChangeParticle(this, server, changes)
      }
    })

    this.previousDocState = this.doc // Reset tracking after sending
  }

  // Override to send to servers instead of looking for closest server
  sendChangeToSyncServer() {
    this.sendChangeToOtherServers()
  }
}

// INSTANCE MANAGEMENT ##############################################################################

let focusedInstance: Typewriter | null = null
let allTypewriters: Typewriter[] = []
let allSyncServers: SyncServer[] = []

// Spawn new typewriter by dragging from the top-left corner
window.addEventListener("mousedown", (e) => {
  e.preventDefault()
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
