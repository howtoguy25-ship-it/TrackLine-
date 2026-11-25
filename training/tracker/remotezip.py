import io, sys, zipfile, urllib.request
class HttpFile(io.RawIOBase):
    def __init__(self, url):
        req = urllib.request.Request(url, method="HEAD")
        r = urllib.request.urlopen(req, timeout=60)
        self.url = r.geturl(); self.size = int(r.headers["Content-Length"]); self.pos = 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req, timeout=120).read()
        self.pos += len(data); return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)
def open_zip(url):
    return zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=1 << 20))
if __name__ == "__main__":
    z = open_zip(sys.argv[1])
    names = z.namelist()
    print(len(names))
    import collections
    ext = collections.Counter(n.rsplit(".", 1)[-1] if "." in n else "dir" for n in names)
    print(ext.most_common(10))
    for n in names:
        if not n.lower().endswith((".jpg", ".png", ".jpeg")): print(n, z.getinfo(n).file_size)
