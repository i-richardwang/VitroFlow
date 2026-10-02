/** LRU storage bounded by retained bytes, including oversized-entry rejection. */
export class ByteCache<T extends { byteLength: number }> {
  private readonly entries = new Map<string, T>();
  private bytes = 0;
  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.byteLength;
      this.entries.delete(key);
    }
    if (value.byteLength > this.capacity) return;
    while (this.bytes + value.byteLength > this.capacity) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    this.bytes += value.byteLength;
  }
}
