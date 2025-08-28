import * as Automerge from "@automerge/automerge"

// Calculate the scale factor that'll get us to the output DPI we want
let charactersPerInch = 11 // this is based on the actual typewriter
let linesPerInch = 8 // ROUGHLY — this is based on the glyph scan Todd sent me
let atlasDPI = 1200 // ROUGHLY — this is based on the glyph scan Todd sent me
let outputDPI = 600 // You can change this to whatever value you want, and everything Just Works™
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
  render()
  ;(document.querySelector("section") as HTMLElement).style.opacity = "1"
}

// RENDERING #######################################################################################

// Initialize the drawing canvases
let elm = document.querySelector("canvas.text") as HTMLCanvasElement
let ctx = elm.getContext("2d")!

// Position to draw the next char
let cx = margin
let cy = padding

// Insertion point screen position
let insertionX = margin * gw
let insertionY = padding * lh

let render = () => {
  // The width of the drawing canvas
  let w = gw * lineWidth

  // We first do a layout-only pass so we can measure the height of the canvas
  cx = margin // Reset the cursor position to the top left
  cy = padding
  drawAllText(characters, false)
  let h = (cy + 1 + padding) * lh // Measure the height of the canvas

  // Before we resize the canvas, check if we're scrolled to the bottom.
  let oldHeight = elm.height

  // Now that we've got the width and height, we can resize the canvas (which also clears it)
  elm.width = w * scale
  elm.height = h * scale
  ctx.scale(scale, scale) // Have to set this every time we resize the canvas.

  if (oldHeight < elm.height) document.body.scrollBy({ top: elm.height - oldHeight })

  // The extra padding on chars means they overlap, so this allows them to overlap nicely
  ctx.globalCompositeOperation = "darken" // Have to set this every time we resize the canvas.

  // Improve visual centering
  ctx.translate(0, verticalAlign)

  // Draw all the chars
  cx = margin // Reset the cursor position to the top left (again)
  cy = padding
  drawAllText(characters, true)

  // Draw insertion point
  ctx.fillStyle = `hsl(0, 70%, ${(Math.random() * 15 + 35) | 0}%)`
  ctx.beginPath()
  ctx.roundRect(insertionX + gw * 0.05, insertionY - lh * 0.2, gw * 0.15, gh * 1.4, gw * 0.05)
  ctx.fill()
}

let drawAllText = (chars: string[], draw: boolean) => {
  let charIndex = 0

  for (let i = 0; i < chars.length; i++) {
    let char = chars[i]

    // Handle newlines
    if (char === "\n") {
      newline()
      charIndex++
      continue
    }

    // For spaces, just advance the cursor (and check if we need to wrap)
    if (char === " ") {
      if (cx >= lineWidth - margin) {
        newline()
      } else {
        cx++
      }
      charIndex++
      continue
    }

    // For non-space chars, check if the whole word fits on current line
    let wordEnd = i
    while (wordEnd < chars.length && chars[wordEnd] !== " " && chars[wordEnd] !== "\n") wordEnd++
    let wordLength = wordEnd - i

    // If word won't fit on current line, wrap to next line
    if (cx + wordLength > lineWidth - margin) newline()

    // Draw regular characters
    let [gx, gy] = getGlyphPosInAtlas(char)
    gx ??= 2257
    gy ??= 97

    // Draw the glyph
    if (draw) {
      let px = cx * gw
      let py = cy * lh
      ctx.drawImage(atlasImg, gx - pad, gy - pad, gw + pad * 2, gh + pad * 2, px - pad, py - pad, gw + pad * 2, gh + pad * 2)
    }

    cx++
    charIndex++

    // Check if this is where the insertion point should be
    if (draw && charIndex === insertionPoint) {
      insertionX = cx * gw
      insertionY = cy * lh
    }
  }

  // Check if insertion point is at the very end
  if (draw && charIndex === insertionPoint) {
    insertionX = cx * gw
    insertionY = cy * lh
  }
}

// Move cursor to beginning of next line
let newline = () => {
  cx = margin
  cy++
}

// INPUT HANDLING ##################################################################################

// Array to store typed characters
let characters: string[] = []

// Insertion point position in the characters array
let insertionPoint = 0

window.addEventListener("keydown", (e) => {
  if (e.key.length === 1) {
    // Regular character - insert at insertion point
    characters.splice(insertionPoint, 0, e.key)
    insertionPoint++
    render()
  } else if (e.key === "Backspace" && insertionPoint > 0) {
    // Backspace - remove character before insertion point
    characters.splice(insertionPoint - 1, 1)
    insertionPoint--
    render()
  } else if (e.key === "Enter") {
    // Enter - add newline at insertion point
    characters.splice(insertionPoint, 0, "\n")
    insertionPoint++
    render()
  } else if (e.key === "ArrowLeft" && insertionPoint > 0) {
    // Move insertion point left
    insertionPoint--
    render()
  } else if (e.key === "ArrowRight" && insertionPoint < characters.length) {
    // Move insertion point right
    insertionPoint++
    render()
  }

  e.preventDefault()
})
