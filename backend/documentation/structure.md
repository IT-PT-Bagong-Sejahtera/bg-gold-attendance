# Backend boundaries

- `controllers` menerima HTTP request dan menyusun response.
- `middlewares` menangani concern lintas request.
- `services` berisi aturan attendance, authentication, dan email.
- `database` membuka koneksi; `migrations` mengelola perubahan schema.
- `common` dan `helpers` hanya berisi utilitas tanpa business flow.
- Bukti foto disimpan privat di MinIO, bukan di folder `uploads`.

Route registry saat ini berada pada `controllers/server.go` agar handler yang bersifat internal tidak perlu diekspor. Daftar route untuk manusia dan tool tetap bersumber dari `documentation/openapi.yaml`.
