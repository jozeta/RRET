/* ==========================================================================
   Custom Target Drawing Canvas
   Minimal freehand + shape drawing tool for the Custom Target Editor modal.
   Exports plain PNG data URLs, which flow into the same `imageData` field (and
   rendering pipeline) already used for uploaded target images — drawing is just
   another way to produce that same value, nothing downstream needs to know the
   difference.
   ========================================================================== */

const MAX_UNDO_STATES = 20;

export class TargetDrawingCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.tool = 'pen';
    this.color = '#1e242b';
    this.strokeWidth = 4;
    this.undoStack = [];
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.snapshot = null;
    this.onChange = null; // set by caller; fires after each committed stroke/shape

    this.blank();
    this.bindEvents();
  }

  setTool(tool) { this.tool = tool; }
  setColor(color) { this.color = color; }
  setStrokeWidth(w) { this.strokeWidth = w; }

  /**
   * Resets to a fully transparent canvas (real alpha=0, not a solid fill) without
   * touching the undo stack — so a drawn target floats over whatever background
   * it's placed on (scope environment, preview box) exactly like the procedural
   * SVG shapes already do, instead of sitting on an opaque colored rectangle.
   */
  blank() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** User-facing "Clear" action: blanks the canvas and records it as undoable. */
  clear() {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.blank();
    if (this.onChange) this.onChange();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (prev) {
      this.ctx.putImageData(prev, 0, 0);
      if (this.onChange) this.onChange();
    }
  }

  /** True if anything has been drawn (any pixel has nonzero alpha). */
  hasContent() {
    const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Draws an image onto the canvas, replacing existing content, but (unlike
   * loadFromDataURL) preserves undo history — used to interactively "copy this
   * preset shape onto the canvas" while editing, so picking the wrong shape
   * doesn't destroy work with no way back.
   */
  stampImage(img) {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undoStack.length > MAX_UNDO_STATES) this.undoStack.shift();
    this.blank();
    this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    if (this.onChange) this.onChange();
  }

  /**
   * Loads an existing image (e.g. a previously saved custom target's drawing or
   * uploaded photo) onto the canvas, stretched to fill it, so editing continues
   * from where it left off instead of starting blank.
   */
  loadFromDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.blank();
        this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        this.undoStack = [];
        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /** Maps a pointer event to canvas-space coordinates, accounting for CSS scaling. */
  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  drawShapePreview(x1, y1, x2, y2) {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = this.color;
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.lineCap = 'round';

    if (this.tool === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    } else if (this.tool === 'rect') {
      this.ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (this.tool === 'ellipse') {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      if (rx < 0.5 || ry < 0.5) return;
      this.ctx.beginPath();
      this.ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.isDrawing = true;
      const { x, y } = this.getPos(e);
      this.startX = x;
      this.startY = y;

      // Snapshot before this gesture: doubles as the undo entry and, for shape
      // tools, the base each live-preview frame restores before redrawing.
      const snap = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.undoStack.push(snap);
      if (this.undoStack.length > MAX_UNDO_STATES) this.undoStack.shift();
      this.snapshot = snap;

      if (this.tool === 'pen' || this.tool === 'eraser') {
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const { x, y } = this.getPos(e);

      if (this.tool === 'pen' || this.tool === 'eraser') {
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        // Eraser punches out real transparency (destination-out) rather than
        // painting over strokes with a solid color.
        this.ctx.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
        this.ctx.strokeStyle = this.color;
        this.ctx.lineWidth = this.tool === 'eraser' ? this.strokeWidth * 3 : this.strokeWidth;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
      } else {
        // Shape tools: restore the pre-drag snapshot each frame, then draw the
        // live preview on top, so dragging doesn't smear intermediate frames.
        this.ctx.putImageData(this.snapshot, 0, 0);
        this.drawShapePreview(this.startX, this.startY, x, y);
      }
    });

    const finish = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.snapshot = null;
      this.ctx.globalCompositeOperation = 'source-over';
      if (this.onChange) this.onChange();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
    this.canvas.addEventListener('pointerleave', finish);
  }
}
