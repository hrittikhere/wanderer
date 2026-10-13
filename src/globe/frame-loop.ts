// A requestAnimationFrame loop that can be suspended. While paused no frame is
// scheduled; a frame requested during the pause runs once the loop resumes.
// Callers own the start/stop decisions, the loop only tracks the pending id.
export class FrameLoop {
  private id = 0;
  private paused = false;
  private pending = false;

  constructor(private readonly frame: (now: number) => void) {}

  request(): void {
    if (this.paused) {
      this.pending = true;
      return;
    }
    this.cancel();
    this.id = requestAnimationFrame((now) => {
      this.id = 0;
      this.frame(now);
    });
  }

  pause(): void {
    this.paused = true;
    if (this.id) {
      cancelAnimationFrame(this.id);
      this.id = 0;
      this.pending = true;
    }
  }

  resume(): void {
    this.paused = false;
    if (this.pending) {
      this.pending = false;
      this.request();
    }
  }

  cancel(): void {
    if (this.id) cancelAnimationFrame(this.id);
    this.id = 0;
    this.pending = false;
  }
}
