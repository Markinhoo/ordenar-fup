# Ordenar FUP

Aplicación React con Vite para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador. El tema claro u oscuro se guarda en este proyecto y la navegación está en el encabezado.

## Nuevo control compartido de documentos

La portada abre el login por nombre de usuario y contraseña. La cuenta administradora inicial usa el usuario `nomina`. Los administradores crean cuentas con usuario, nombre visible, rol, contraseña y pregunta de seguridad. Solo el rol administrador carga el Excel, elige mes y quincena y reparte registros entre operadores. El reparto se calcula automáticamente, con una diferencia máxima de un registro entre personas. La QNA usa `AAAANN`: enero primera `202601`, enero segunda `202602` y diciembre segunda `202624`. Los registros quedan ordenados por RFC y repartidos en ese orden.

Al crear un lote, cada operador queda asignado a su cuenta. El lote aparece automáticamente en su vista, incluso si ya tenía la página abierta. Ve su QR particular para abrirlo en el celular y puede escanear documentos físicos. Los QR se generan por lote y persona; el servidor comprueba la cuenta asignada. Los administradores pueden cambiar roles y nombres de usuario y asignar una nueva contraseña desde **Administrar usuarios**. Una cuenta operadora no puede crear lotes ni marcar casillas manualmente.

Cada usuario puede cambiar su contraseña y configurar una pregunta de respaldo privada en **Mi cuenta**. Si olvida la contraseña, la restablece con su respuesta. Solo se guarda un hash de esa respuesta; tras cinco intentos fallidos, la recuperación se bloquea durante 30 minutos. Supabase Auth usa un identificador interno con formato de correo, que no se solicita ni se muestra a los usuarios.

Cada colaborador ve el avance general y su asignación. Para registrar un documento, enfoca con el celular el recuadro completo o toma una foto: el lector extrae procedencia, nivel, número de documento y fecha, y pide confirmar la lectura. La casilla del listado está deshabilitada para colaboradores. La encargada puede marcar o desmarcar manualmente con una observación obligatoria. También puede añadir un documento físico ausente del Excel con folio, datos del recuadro y motivo. Todo movimiento queda en la bitácora, con QNA, responsable y fecha; se puede buscar en QNAs anteriores y descargar un CSV completo.

La información del nuevo control se guarda solo en tablas `v2_*` del esquema aislado `"fup-sep"` del proyecto Supabase **aria-arquitectura**. El Excel original y las imágenes capturadas se procesan en el navegador y no se guardan. El progreso se actualiza cada cinco segundos. La lectura de texto usa Tesseract.js en el dispositivo y necesita Internet para descargar el lector la primera vez.

## Verificación anterior

Las salas creadas antes del sistema de cuentas se abren ahora en una pantalla React. Los enlaces anteriores `organizar.html?s=...` siguen funcionando y muestran esa sala; los QR nuevos de esas salas usan `/sala?s=...`. El control actual usa cuentas y QNAs.

## Base de datos

`supabase/fup-sep-v7.sql` agrega nombres de usuario y roles y enlaza cada operador al lote cuando se crea. Se aplica después de `v6` y antes de publicar la versión actualizada de `supabase/functions/fup-accounts/index.ts`. La activación inicial usa `supabase/fup-sep-v5.sql`; la consulta `select "fup-sep".v4_issue_admin_activation();` genera un token aleatorio que vence en 24 horas. La ruta anterior `activar.html` también funciona.

El esquema `fup-sep` debe permanecer en **Exposed schemas** de Data API. Las tablas tienen RLS y no conceden acceso directo a visitantes. Los roles viven en `"fup-sep".v3_accounts`; `v2_is_admin()` los verifica del lado del servidor. La función `supabase/functions/fup-accounts/index.ts` se publica en Supabase y usa la clave de servicio que Supabase le proporciona internamente. No se guarda esa clave en Vercel ni en GitHub.

## Estructura

- `index.html`: única entrada HTML necesaria para montar React.
- `src/pages/`: pantallas React de control, organizador, activación y salas anteriores.
- `src/components/`: pantallas de acceso, cuentas, lote, lista, escáner y bitácora.
- `src/lib/`: API, Excel, OCR, QR, QNA, descarga y tema.
- `src/styles/`: estilos de cada vista y temas.
- `dist/`: resultado generado por Vite; contiene una copia compilada de `index.html` y no se guarda en Git.
- `vercel.json`: compila el proyecto y publica `dist/` en Vercel.

## Ejecutar en la computadora

Con Node.js instalado, abre una terminal en `C:\Users\Marko\ordenar-fup` y ejecuta:

```powershell
npm install
npm run dev
```

Abre la dirección local que muestre Vite (normalmente `http://127.0.0.1:5173`). Usa `npm run build` para comprobar la compilación y `Ctrl+C` para detener el servidor.

El generador QR usa la dependencia [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
