import * as Automerge from "@automerge/automerge"

// Calculate the scale factor that'll get us to the output DPI we want
let charactersPerInch = 11 // this is based on the actual typewriter
let linesPerInch = 8 // ROUGHLY — this is based on the glyph scan Todd sent me
let atlasDPI = 1200 // ROUGHLY — this is based on the glyph scan Todd sent me
let outputDPI = 600 // You can change this to whatever value you want, and everything Just Works™
let scale = outputDPI / atlasDPI

// The width of the canvas
let lineWidth = 64 // this works out to A5 paper width

// These create empty space…
let margin = 6 // left and right — measure in character widths
let padding = 3 // on the top and bottom — measure in line heights

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
let endOfLine = false

let render = () => {
  let text = characters.join("")
  let words = text.split(" ")

  // The width of the drawing canvas
  let w = gw * lineWidth

  // We first do a layout-only pass so we can measure the height of the canvas
  cx = margin // Reset the cursor position to the top left
  cy = padding
  endOfLine = false
  words.forEach((_, i) => drawWord(i, words, false))
  let h = (cy + 1 + padding) * lh // Measure the height of the canvas

  // Before we resize the canvas, check if we're scrolled to the bottom.
  let oldHeight = elm.height

  // Now that we've got the width and height, we can update the canvas
  elm.width = w * scale
  elm.height = h * scale
  ctx.scale(scale, scale) // Have to set this every time we resize the canvas.

  if (oldHeight < elm.height) {
    document.body.scrollBy({ top: elm.height - oldHeight })
  }

  // The extra padding on chars means they overlap, so this allows them to overlap nicely
  ctx.globalCompositeOperation = "darken" // Have to set this every time we resize the canvas.

  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, w, h)

  // For debugging glyph layout
  ctx.fillStyle = "#f001"

  // Finally, we can draw all the chars
  cx = margin // Reset the cursor position to the top left (again)
  cy = padding
  endOfLine = false
  words.forEach((_, i) => drawWord(i, words, true))
}

let drawWord = (i: number, words: string[], draw: boolean) => {
  let word = words[i]
  let lastWord = i === words.length - 1

  if (word.length === 0) {
    if (!endOfLine && !lastWord) {
      adv()
    }
    return
  }

  // First, figure out if there's room on the line for this word
  if (cx + word.length >= lineWidth - margin) {
    newline()
  }

  for (let [, k] of [...word].entries()) {
    endOfLine = false

    if (k === "\n") {
      newline()
      continue
    }

    let [gx, gy] = getGlyphPosInAtlas(k)
    // if (gx == null || gy == null) [gx, gy] = getGlyphPosInAtlas("*")
    gx ??= 2257
    gy ??= 97

    // Draw the glyph at these pixel coords
    let px = cx * gw
    let py = cy * lh + verticalAlign

    if (draw) {
      ctx.drawImage(atlasImg, gx - pad, gy - pad, gw + pad * 2, gh + pad * 2, px - pad, py - pad, gw + pad * 2, gh + pad * 2)
    }

    adv() // advance to the next letter
  }

  if (cx !== margin && !lastWord) {
    adv() // advance one extra space for the next word
  }
}

// Advance the cursor by one space
let adv = () => {
  if (endOfLine) return
  cx++
  if (cx >= lineWidth - margin) {
    endOfLine = true
    newline()
  }
}

// Advance the cursor to the beginning of the next line
let newline = () => {
  cx = margin
  cy++
}

// INPUT HANDLING ##################################################################################

// Array to store typed characters
let characters: string[] = []

window.addEventListener("keydown", (e) => {
  if (e.key.length === 1) {
    // Regular character
    characters.push(e.key)
    render()
  } else if (e.key === "Backspace" && characters.length > 0) {
    // Backspace - remove last character
    characters.pop()
    render()
  } else if (e.key === "Enter") {
    // Enter - add newline
    characters.push("\n")
    render()
  }

  e.preventDefault()
})
