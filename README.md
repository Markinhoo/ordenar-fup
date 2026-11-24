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

## Administración de cuentas

`supabase/fup-sep-v8.sql` se aplica después de `v7`. Permite nombres de usuario con espacios y protege a la última cuenta administradora contra eliminación. **Administrar usuarios** es una página completa para buscar, editar, cambiar roles y eliminar cuentas. La respuesta de seguridad puede ser corta. Los movimientos de cuentas eliminadas permanecen en la bitácora; sus lotes administrativos pasan al administrador que las elimina.

Al crear una cuenta o cambiar la pregunta de respaldo, se elige entre lugar de nacimiento, nombre de mascota y nombre de la primera escuela. Las preguntas personalizadas guardadas antes siguen apareciendo al recuperar una cuenta; al reemplazarlas se debe elegir una de las tres opciones.

## Descarga y ayuda entre operadores

La descarga del Excel alfabetizado tiene una casilla **Con colores**. Sin marcarla, se ordenan RFC y folio sin añadir colores ni la leyenda de distribución, y no hace falta seleccionar operadores. Al marcarla, se pintan los registros por persona y se añade la leyenda al final.

`supabase/fup-sep-v9.sql` permite que un operador ya asignado al lote escanee cualquier folio de ese mismo lote para ayudar a otra persona. La asignación original no cambia. **Responsable** muestra a quien registró el documento y la bitácora conserva las revisiones registradas. Un operador ajeno al lote no puede entrar ni escanearlo.

## QR personal y escaneo continuo

`supabase/fup-sep-v10.sql` crea códigos temporales de un solo uso en `fup-sep`. El QR aparece al principio del listado cuando un operador asignado o el administrador del lote inicia sesión. Al escanearlo desde el celular se abre su propia cuenta directamente en ese lote, sin volver a pedir usuario y contraseña. Cada código vence en dos minutos y se renueva mientras el listado está abierto. El QR identifica a la cuenta; la dirección también indica qué lote abrir. Los documentos se registran con la identidad de esa cuenta. `supabase/fup-sep-v12.sql` habilita el QR y el escaneo para el administrador del lote, conservando su permiso para marcar manualmente.

El QR incluye `scan=1` y abre únicamente el escáner del lote indicado. Entrar por la liga normal abre el sistema completo. La vista del QR ocupa toda la pantalla del sitio e intenta activar el modo horizontal; si el navegador no lo permite automáticamente, el botón **Pantalla completa horizontal** lo solicita mediante un toque. `supabase/fup-sep-v13.sql` actualiza el disparador de la bitácora para aceptar escaneos de operadores y administradores con acceso al lote.

El escáner lee automáticamente el recuadro y confirma dos lecturas con el mismo folio y fecha antes de registrar. Muestra una palomita verde al guardar. `supabase/fup-sep-v11.sql` impide que un folio ya registrado cambie de responsable: un nuevo intento muestra **Documento ya escaneado**.

El motor, el modelo inglés y los archivos WebAssembly de Tesseract se sirven desde `public/ocr/` para evitar descargas desde un CDN en el celular. El OCR lee primero el recuadro completo y después reconoce la zona del folio solo como dígitos; si falta otro campo, vuelve a leer su zona. La pantalla indica cuál campo falta para ajustar la distancia de la cámara.
