import * as Automerge from "@automerge/automerge"

// AUTOMERGE SETUP #################################################################################

// Create canonical root document that all typewriter docs will fork from
const rootDoc = Automerge.change(Automerge.init<{ characters: string }>(), (doc) => {
  doc.characters = ""
})

console.log("Root document created:", rootDoc)

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
atlasImg.onload = () => {
  // Create sync server at center-top of screen
  syncServer = new SyncServer(window.innerWidth / 2 - 200, 100)
  syncServer.render()

  // No initial regular typewriter - user creates them by clicking in top-left corner
}

// TYPEWRITER INSTANCE CLASS #######################################################################

class TypewriterInstance {
  elm = document.createElement("canvas")
  ctx = this.elm.getContext("2d")!
  doc = Automerge.clone(rootDoc)
  previousDocState = this.doc
  insertionPoint = 0

  // Position to draw the next char
  cx = margin
  cy = padding

  // Insertion point screen position
  insertionX = margin * gw
  insertionY = padding * lh

  constructor(x = 0, y = 0) {
    this.elm.className = "text"
    this.elm.style.left = `${x}px`
    this.elm.style.top = `${y}px`
    document.body.appendChild(this.elm)

    // Add drag functionality
    this.elm.onmousedown = (e) => {
      this.startDrag(e)
    }

    // Register this typewriter
    allTypewriters.push(this)

    console.log("TypewriterInstance created with doc:", this.doc)
    console.log("Doc has characters field:", "characters" in this.doc)
  }

  // Helper method to get changes since last tracked state
  getDocumentChanges() {
    const changes = Automerge.getChanges(this.previousDocState, this.doc)
    console.log("Document changes since last state:", changes)
    return changes
  }

  // Extract all accumulated changes and reset tracking
  extractChanges() {
    const changes = this.getDocumentChanges()
    this.previousDocState = this.doc // Reset tracking point
    return changes
  }

  // Apply changes from another document (from particles)
  applyChanges(changes: Uint8Array[]) {
    console.log("Applying changes:", changes.length, "changes")
    this.previousDocState = this.doc
    const [newDoc] = Automerge.applyChanges(this.doc, changes)
    this.doc = newDoc
    console.log("Doc after applying changes:", this.doc.characters)
    this.render()

    // Don't send changes back to sync server when applying from particles
    // (this would create infinite loops)
  }

  // Send change to sync server via particle
  sendChangeToSyncServer() {
    // Don't send if we ARE the sync server, or if sync server doesn't exist
    if (this instanceof SyncServer || !syncServer) return

    const changes = this.getDocumentChanges()
    if (changes.length > 0) {
      console.log("Sending", changes.length, "changes to sync server via particle")
      particleManager.addChangeParticle(this, syncServer, changes)
      // Reset tracking after sending
      this.previousDocState = this.doc
    }
  }

  focus() {
    let previousFocus = focusedInstance
    focusedInstance = this
    if (previousFocus && previousFocus !== this) {
      previousFocus.render()
    }
    this.render()
  }

  startDrag(e: MouseEvent) {
    let dragStartX = e.clientX
    let dragStartY = e.clientY
    let elementStartX = parseInt(this.elm.style.left)
    let elementStartY = parseInt(this.elm.style.top)
    this.focus()
    e.preventDefault()

    const onMouseMove = (e: MouseEvent) => {
      let newX = elementStartX + (e.clientX - dragStartX)
      let newY = elementStartY + (e.clientY - dragStartY)
      this.elm.style.left = `${newX}px`
      this.elm.style.top = `${newY}px`
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  insertCharacter(char: string) {
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      doc.characters = doc.characters.slice(0, this.insertionPoint) + char + doc.characters.slice(this.insertionPoint)
    })
    this.insertionPoint++
    console.log("Character inserted:", char, "Doc characters now:", this.doc.characters)
    console.log("Insertion point:", this.insertionPoint)

    // Send change to sync server via particle (if this isn't the sync server)
    this.sendChangeToSyncServer()

    this.render()
  }

  deleteCharacter() {
    if (this.insertionPoint > 0) {
      this.previousDocState = this.doc
      this.doc = Automerge.change(this.doc, (doc) => {
        doc.characters = doc.characters.slice(0, this.insertionPoint - 1) + doc.characters.slice(this.insertionPoint)
      })
      this.insertionPoint--
      console.log("Character deleted, Doc characters now:", this.doc.characters)

      // Send change to sync server via particle
      this.sendChangeToSyncServer()

      this.render()
    }
  }

  insertNewline() {
    this.previousDocState = this.doc
    this.doc = Automerge.change(this.doc, (doc) => {
      doc.characters = doc.characters.slice(0, this.insertionPoint) + "\n" + doc.characters.slice(this.insertionPoint)
    })
    this.insertionPoint++
    console.log("Newline inserted, Doc characters now:", this.doc.characters)

    // Send change to sync server via particle
    this.sendChangeToSyncServer()

    this.render()
  }

  moveLeft() {
    if (this.insertionPoint > 0) {
      this.insertionPoint--
      console.log("Cursor moved left, insertion point:", this.insertionPoint)
      this.render()
    }
  }

  moveRight() {
    if (this.insertionPoint < this.doc.characters.length) {
      this.insertionPoint++
      console.log("Cursor moved right, insertion point:", this.insertionPoint)
      this.render()
    }
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
  x: number
  y: number
  targetX: number
  targetY: number
  startX: number
  startY: number
  progress = 0
  speed = 0.02 // Animation speed (0-1 per frame)
  size = 8
  color = "hsl(300, 80%, 60%)"

  // Change data this particle is carrying
  changes: Uint8Array[]
  source: TypewriterInstance
  target: TypewriterInstance

  constructor(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    changes: Uint8Array[],
    source: TypewriterInstance,
    target: TypewriterInstance
  ) {
    this.startX = startX
    this.startY = startY
    this.x = startX
    this.y = startY
    this.targetX = targetX
    this.targetY = targetY
    this.changes = changes
    this.source = source
    this.target = target

    console.log("Particle created carrying", changes.length, "changes")
  }

  update() {
    if (this.progress < 1) {
      this.progress += this.speed

      // Debug logging for broadcast particles
      if (this.source instanceof SyncServer) {
        console.log(`Broadcast particle progress: ${this.progress.toFixed(3)}, pos: (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`)
      }

      // Smooth easing animation
      const eased = 1 - Math.pow(1 - this.progress, 3) // Ease out cubic

      this.x = this.startX + (this.targetX - this.startX) * eased
      this.y = this.startY + (this.targetY - this.startY) * eased

      return false // Still animating
    }
    
    // Debug when complete
    if (this.source instanceof SyncServer) {
      console.log("Broadcast particle completed animation!")
    }
    
    return true // Animation complete
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
  animationId: number | null = null

  // Add particle carrying changes
  addChangeParticle(source: TypewriterInstance, target: TypewriterInstance, changes: Uint8Array[]) {
    // Get positions of source and target
    const sourceRect = source.elm.getBoundingClientRect()
    const targetRect = target.elm.getBoundingClientRect()

    const startX = sourceRect.left + sourceRect.width / 2
    const startY = sourceRect.top + sourceRect.height / 2
    const targetX = targetRect.left + targetRect.width / 2
    const targetY = targetRect.top + targetRect.height / 2

    const particle = new Particle(startX, startY, targetX, targetY, changes, source, target)
    this.particles.push(particle)
    console.log("Change particle added, total particles:", this.particles.length)

    // Start animation loop if not running
    if (!this.animationId) {
      this.startAnimation()
    }

    return particle
  }

  // Legacy method for test particles (without changes)
  addParticle(startX: number, startY: number, targetX: number, targetY: number) {
    const particle = new Particle(startX, startY, targetX, targetY, [], null as any, null as any)
    this.particles.push(particle)
    console.log("Test particle added, total particles:", this.particles.length)

    // Start animation loop if not running
    if (!this.animationId) {
      this.startAnimation()
    }

    return particle
  }

  startAnimation() {
    const animate = () => {
      this.update()
      this.draw()

      if (this.particles.length > 0) {
        this.animationId = requestAnimationFrame(animate)
      } else {
        this.animationId = null
      }
    }
    animate()
  }

  update() {
    console.log(`ParticleManager update: ${this.particles.length} particles`)
    
    // Collect completed particles first
    const completedParticles: Particle[] = []
    
    // Update all particles and remove completed ones
    this.particles = this.particles.filter((particle) => {
      const isComplete = particle.update()
      if (isComplete) {
        console.log("Particle animation complete")
        completedParticles.push(particle)
      }
      return !isComplete
    })
    
    console.log(`After update: ${this.particles.length} particles remaining`)
    
    // Process completed particles AFTER filtering is done
    completedParticles.forEach(particle => {
      this.onParticleComplete(particle)
    })
    
    console.log(`After completion callbacks: ${this.particles.length} particles`)
  }

  draw() {
    // Draw particles on a global overlay canvas
    if (!this.overlayCanvas) {
      this.createOverlay()
    }

    this.overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    this.particles.forEach((particle) => {
      particle.draw(this.overlayCtx)
    })
  }

  overlayCanvas!: HTMLCanvasElement
  overlayCtx!: CanvasRenderingContext2D

  createOverlay() {
    this.overlayCanvas = document.createElement("canvas")
    this.overlayCanvas.style.position = "fixed"
    this.overlayCanvas.style.top = "0"
    this.overlayCanvas.style.left = "0"
    this.overlayCanvas.style.width = "100vw"
    this.overlayCanvas.style.height = "100vh"
    this.overlayCanvas.style.pointerEvents = "none"
    this.overlayCanvas.style.zIndex = "1000"
    this.overlayCanvas.width = window.innerWidth
    this.overlayCanvas.height = window.innerHeight

    this.overlayCtx = this.overlayCanvas.getContext("2d")!
    document.body.appendChild(this.overlayCanvas)

    console.log("Particle overlay canvas created")
  }

  onParticleComplete(particle: Particle) {
    console.log("Particle reached target")
    console.log("  - Changes length:", particle.changes.length)
    console.log("  - Target exists:", !!particle.target)
    console.log("  - Target type:", particle.target.constructor.name)
    console.log("  - Source type:", particle.source.constructor.name)

    // Apply changes if this particle was carrying them
    if (particle.changes.length > 0 && particle.target) {
      console.log("Applying", particle.changes.length, "changes from particle to target")

      // Use special method for sync server to avoid broadcasting
      if (particle.target instanceof SyncServer) {
        console.log("  -> Applying to SyncServer via applyChangesFromParticle")
        ;(particle.target as SyncServer).applyChangesFromParticle(particle.changes, particle.source)
      } else {
        console.log("  -> Applying to regular TypewriterInstance via applyChanges")
        particle.target.applyChanges(particle.changes)
      }
    } else {
      console.log("  -> No changes to apply (length=0 or no target)")
    }
  }
}

// Global particle manager
const particleManager = new ParticleManager()

// SYNC SERVER CLASS ################################################################################

class SyncServer extends TypewriterInstance {
  constructor(x: number, y: number) {
    super(x, y)

    // Override styling for sync server
    this.elm.style.backgroundColor = "hsl(200, 70%, 95%)"
    this.elm.style.border = "2px solid hsl(200, 70%, 70%)"
    this.elm.style.borderRadius = "8px"

    console.log("SyncServer created at", x, y)
  }

  // Apply changes without broadcasting (for particle delivery)
  applyChangesFromParticle(changes: Uint8Array[], sourceTypewriter?: TypewriterInstance) {
    console.log("SyncServer: Applying changes from particle and broadcasting via particles")

    // Apply changes to self
    super.applyChanges(changes)

    // Broadcast to all other typewriters via particles (excluding source)
    this.broadcastChangesViaParticles(changes, sourceTypewriter)
  }

  // Override applyChanges to add broadcasting (for manual sync)
  applyChanges(changes: Uint8Array[]) {
    console.log("SyncServer: Applying changes and broadcasting...")

    // Apply changes to self
    super.applyChanges(changes)

    // Broadcast to all other typewriters (not the sync server itself)
    this.broadcastChanges(changes)
  }

  // Broadcast changes via particles
  broadcastChangesViaParticles(changes: Uint8Array[], excludeSource?: TypewriterInstance) {
    const targetTypewriters = allTypewriters.filter((tw) => tw !== this && tw !== excludeSource)
    console.log("SyncServer: Broadcasting via particles to", targetTypewriters.length, "typewriters")
    console.log("Total typewriters:", allTypewriters.length, "excluding sync server and source:", targetTypewriters.length)

    targetTypewriters.forEach((typewriter, index) => {
      console.log(`Sending broadcast particle ${index + 1} to typewriter...`)
      particleManager.addChangeParticle(this, typewriter, changes)
    })

    console.log("SyncServer: Broadcast particles sent")
  }

  // Legacy immediate broadcast (for manual sync)
  broadcastChanges(changes: Uint8Array[]) {
    console.log("SyncServer: Broadcasting immediately to", allTypewriters.length, "typewriters")

    allTypewriters.forEach((typewriter) => {
      if (typewriter !== this) {
        // Don't broadcast to self
        console.log("Broadcasting to typewriter...")
        typewriter.applyChanges(changes)
      }
    })

    console.log("SyncServer: Broadcast complete")
  }
}

// INSTANCE MANAGEMENT ##############################################################################

let focusedInstance: TypewriterInstance | null = null
let syncServer: SyncServer | null = null
let lastExtractedChanges: Uint8Array[] = [] // Store changes for testing
let allTypewriters: TypewriterInstance[] = [] // Track all typewriter instances

// Helper function to copy changes from one typewriter to another
function copyChanges(source: TypewriterInstance, target: TypewriterInstance) {
  console.log("=== COPYING CHANGES ===")
  console.log("From:", source === syncServer ? "SyncServer" : "Typewriter")
  console.log("To:", target === syncServer ? "SyncServer" : "Typewriter")

  const changes = source.extractChanges()
  if (changes.length > 0) {
    target.applyChanges(changes)
    console.log("Successfully copied", changes.length, "changes")
  } else {
    console.log("No changes to copy")
  }
  console.log("=== END COPY ===")
}

// Spawn new typewriter by clicking in top-left corner
window.addEventListener("mousedown", (e) => {
  if (e.clientX <= 50 && e.clientY <= 50) {
    let newInstance = new TypewriterInstance(e.clientX, e.clientY)
    newInstance.focus()
    newInstance.startDrag(e)
  }
})

window.addEventListener("keydown", (e) => {
  if (!focusedInstance) return

  // Manual change extraction - press Ctrl+E
  if (e.key === "e" && e.ctrlKey) {
    console.log("=== MANUAL CHANGE EXTRACTION ===")
    const changes = focusedInstance.extractChanges()
    lastExtractedChanges = changes // Store for manual application
    console.log("Extracted changes:", changes)
    console.log("Changes count:", changes.length)
    if (changes.length > 0) {
      console.log("First change details:", changes[0])
      console.log("Change structure keys:", Object.keys(changes[0]))
    }
    console.log("Stored changes for manual application (use Ctrl+A)")
    console.log("=== END EXTRACTION ===")
    e.preventDefault()
    return
  }

  // Manual change application - press Ctrl+A
  if (e.key === "a" && e.ctrlKey) {
    console.log("=== MANUAL CHANGE APPLICATION ===")
    if (lastExtractedChanges.length > 0) {
      console.log("Applying", lastExtractedChanges.length, "stored changes to focused instance")
      focusedInstance.applyChanges(lastExtractedChanges)
    } else {
      console.log("No stored changes to apply - extract some first with Ctrl+E")
    }
    console.log("=== END APPLICATION ===")
    e.preventDefault()
    return
  }

  // Copy changes TO sync server - press Ctrl+S
  if (e.key === "s" && e.ctrlKey) {
    if (syncServer && focusedInstance !== syncServer) {
      copyChanges(focusedInstance, syncServer)
    } else {
      console.log("Focus a typewriter (not sync server) to copy changes TO sync server")
    }
    e.preventDefault()
    return
  }

  // Send changes via PARTICLE to sync server - press Ctrl+Shift+S
  if (e.key === "S" && e.ctrlKey) {
    if (syncServer && focusedInstance !== syncServer) {
      console.log("Sending changes via particle to sync server")
      const changes = focusedInstance.extractChanges()
      if (changes.length > 0) {
        particleManager.addChangeParticle(focusedInstance, syncServer, changes)
      } else {
        console.log("No changes to send")
      }
    } else {
      console.log("Focus a typewriter (not sync server) to send changes via particle")
    }
    e.preventDefault()
    return
  }

  // Copy changes FROM sync server - press Ctrl+R
  if (e.key === "r" && e.ctrlKey) {
    if (syncServer && focusedInstance !== syncServer) {
      copyChanges(syncServer, focusedInstance)
    } else {
      console.log("Focus a typewriter (not sync server) to copy changes FROM sync server")
    }
    e.preventDefault()
    return
  }

  // Test particle animation - press Ctrl+P
  if (e.key === "p" && e.ctrlKey) {
    if (syncServer) {
      console.log("Spawning test particle from focused instance to sync server")

      // Get positions of source and target
      const sourceRect = focusedInstance.elm.getBoundingClientRect()
      const targetRect = syncServer.elm.getBoundingClientRect()

      const startX = sourceRect.left + sourceRect.width / 2
      const startY = sourceRect.top + sourceRect.height / 2
      const targetX = targetRect.left + targetRect.width / 2
      const targetY = targetRect.top + targetRect.height / 2

      particleManager.addParticle(startX, startY, targetX, targetY)
    }
    e.preventDefault()
    return
  }

  if (e.key.length === 1) return focusedInstance.insertCharacter(e.key)
  if (e.key === "Backspace") return focusedInstance.deleteCharacter()
  if (e.key === "Enter") return focusedInstance.insertNewline()
  if (e.key === "ArrowLeft") return focusedInstance.moveLeft()
  if (e.key === "ArrowRight") return focusedInstance.moveRight()
  e.preventDefault()
})
