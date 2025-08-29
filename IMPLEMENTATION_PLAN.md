# Automerge Integration Implementation Plan

## Overview
Transform the typewriter system to use Automerge documents with animated particle-based synchronization. Each particle carries actual Automerge changes between typewriters via a central sync server.

## Phase 1: Automerge Foundation
*Goal: Replace string arrays with Automerge documents, ensure local typing still works*

### Step 1.1: Set up Automerge document structure
- Create canonical root document with `characters` text field
- Replace `characters: string[]` in TypewriterInstance with `doc` and `previousDocState`
- Update constructor to fork from root document
- **Verification**: Console log the doc structure, ensure it has `characters` field

### Step 1.2: Convert character insertion to Automerge
- Update `insertCharacter()` method to use `Automerge.change()`
- Ensure `insertionPoint` tracking still works with Automerge text
- **Verification**: Typing should work normally, console log doc changes

### Step 1.3: Convert other editing operations to Automerge  
- Update `deleteCharacter()`, `insertNewline()`, `moveLeft()`, `moveRight()`
- All operations should work on `doc.characters` instead of array
- **Verification**: All keyboard operations work, doc state reflects changes

### Step 1.4: Update rendering to use Automerge document
- Modify `drawAllText()` to iterate over `this.doc.characters` 
- Ensure cursor positioning works with Automerge text
- **Verification**: Rendering displays text from Automerge doc correctly

### Step 1.5: Add document state tracking
- Track `previousDocState` after each change
- Add helper method `getDocumentChanges()` that returns changes since last state
- **Verification**: Console log changes after each keystroke, should show Automerge change objects

## Phase 2: Change Collection and Application
*Goal: Verify we can extract changes from one doc and apply them to another*

### Step 2.1: Create sync server typewriter
- Add special `SyncServer` class extending `TypewriterInstance`
- Style differently (different background color, position)
- Spawn sync server instance on startup
- **Verification**: Sync server appears with distinct visual styling

### Step 2.2: Add manual change extraction
- Add button/keyboard shortcut to manually extract changes from focused typewriter
- Console log the extracted changes in readable format
- **Verification**: Can see individual keystroke changes in console

### Step 2.3: Add manual change application
- Add button/keyboard shortcut to manually apply changes to sync server
- Store a test change and apply it to sync server's document
- **Verification**: Sync server's text updates when change is applied

### Step 2.4: Test bidirectional change flow
- Create method to copy changes from one typewriter to another
- Test: Type in Typewriter A → extract changes → apply to Sync Server → extract from Sync Server → apply to Typewriter B
- **Verification**: Text appears in both typewriters, documents stay in sync

### Step 2.5: Add change broadcasting
- When sync server receives a change, automatically broadcast to all other typewriters
- Implement immediate synchronization (no animation yet)
- **Verification**: Type in any typewriter, see text appear in all others instantly

## Phase 3: Particle Animation System
*Goal: Replace immediate sync with animated particles that carry changes*

### Step 3.1: Create basic particle system
- Add `Particle` class with source, target, position, animation state
- Add particle manager to handle updating/rendering particles
- Create simple visual particles (colored circles)
- **Verification**: Can spawn test particles that animate across screen

### Step 3.2: Add change-carrying particles
- Modify `Particle` class to carry Automerge change data
- Create particles when changes are made, instead of immediate sync
- **Verification**: Particles spawn when typing, but don't apply changes yet

### Step 3.3: Implement particle-to-sync-server flow
- When particle reaches sync server, apply the carried change
- Particles should originate from typewriter and animate to sync server
- **Verification**: Type in typewriter → particle animates to sync server → text appears in sync server

### Step 3.4: Implement sync-server-to-typewriter broadcast particles
- When sync server receives change, spawn particles to all other typewriters
- Each particle carries the same change data
- **Verification**: Type in Typewriter A → particle to sync server → broadcast particles to other typewriters

### Step 3.5: Complete the particle sync loop  
- When broadcast particles reach target typewriters, apply changes
- Remove immediate synchronization, rely entirely on particle system
- **Verification**: Full flow works: Type in A → particle to sync server → particles to B,C,etc → text appears everywhere

### Step 3.6: Add visual polish and particle effects
- Improve particle visuals (trails, colors, size changes)
- Add particle spawn/arrival effects
- Tune animation timing and easing
- **Verification**: Smooth, visually appealing particle animations

### Step 3.7: Handle edge cases and cleanup
- Handle rapid typing (multiple particles in flight)
- Ensure proper cleanup of completed particles  
- Test with multiple simultaneous typists
- **Verification**: System remains stable under heavy use, no memory leaks

## Phase 4: Polish and Optimization (Future)
- Conflict resolution testing
- Performance optimization for many typewriters
- Particle batching for rapid typing
- Visual feedback for sync status

---

## Testing Strategy
After each step:
1. Manual testing in browser to verify functionality
2. Console logging to verify internal state
3. Git commit of working state
4. Opportunity for refactoring before next step

## Notes
- Each typewriter maintains its own Automerge document
- All documents are forked from the same canonical root
- Particles are the single source of truth for changes in flight
- Sync server is just a special typewriter that broadcasts received changes