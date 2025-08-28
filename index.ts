import * as Automerge from "@automerge/automerge"

// Calculate the scale factor that'll get us to the output DPI we want
let charactersPerInch = 11 // this is based on the actual typewriter
let linesPerInch = 8 // ROUGHLY — this is based on the glyph scan Todd sent me
let atlasDPI = 1200 // ROUGHLY — this is based on the glyph scan Todd sent me
let outputDPI = 300 // You can change this to whatever value you want, and everything Just Works™
let scale = outputDPI / atlasDPI

// The width of the canvas
let lineWidth = 24 // this works out to A5 paper width

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
  // Create initial typewriter instance
  let instance = new TypewriterInstance()
  focusedInstance = instance
  instance.render()
}

// TYPEWRITER INSTANCE CLASS #######################################################################

class TypewriterInstance {
  elm = document.createElement("canvas")
  ctx = this.elm.getContext("2d")!
  characters: string[] = []
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
      let dragStartX = e.clientX
      let dragStartY = e.clientY
      let elementStartX = parseInt(this.elm.style.left)
      let elementStartY = parseInt(this.elm.style.top)
      focusedInstance = this
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

    for (let i = 0; i < this.characters.length; i++) {
      let char = this.characters[i]

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
      while (wordEnd < this.characters.length && this.characters[wordEnd] !== " " && this.characters[wordEnd] !== "\n") wordEnd++
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

// INSTANCE MANAGEMENT ##############################################################################

let focusedInstance: TypewriterInstance | null = null

window.addEventListener("keydown", (e) => {
  if (!focusedInstance) return

  if (e.key.length === 1) {
    // Regular character - insert at insertion point
    focusedInstance.characters.splice(focusedInstance.insertionPoint, 0, e.key)
    focusedInstance.insertionPoint++
    focusedInstance.render()
  } else if (e.key === "Backspace" && focusedInstance.insertionPoint > 0) {
    // Backspace - remove character before insertion point
    focusedInstance.characters.splice(focusedInstance.insertionPoint - 1, 1)
    focusedInstance.insertionPoint--
    focusedInstance.render()
  } else if (e.key === "Enter") {
    // Enter - add newline at insertion point
    focusedInstance.characters.splice(focusedInstance.insertionPoint, 0, "\n")
    focusedInstance.insertionPoint++
    focusedInstance.render()
  } else if (e.key === "ArrowLeft" && focusedInstance.insertionPoint > 0) {
    // Move insertion point left
    focusedInstance.insertionPoint--
    focusedInstance.render()
  } else if (e.key === "ArrowRight" && focusedInstance.insertionPoint < focusedInstance.characters.length) {
    // Move insertion point right
    focusedInstance.insertionPoint++
    focusedInstance.render()
  }

  e.preventDefault()
})
