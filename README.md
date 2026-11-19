# Ordenar FUP

Aplicación estática para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador.

## Nuevo control compartido de documentos

La portada abre el login antes de mostrar el sistema. La cuenta administradora `nomina@fup.com` puede cargar el Excel, ordenar y descargar el archivo, elegir mes y QNA, y escribir el nombre, correo y cantidad de archivos físicos de cada persona. El resto del equipo solo ve la verificación después de iniciar sesión y abrir su QR. Los registros quedan ordenados por RFC y repartidos en ese orden. Cada persona recibe un QR distinto, ligado al correo de su cuenta. Al abrirlo, debe entrar o crear su cuenta y confirmar su correo. El QR se genera de nuevo para cada lote.

Cada colaborador ve el avance general y su asignación. Para registrar un documento, enfoca con el celular el recuadro completo o toma una foto: el lector extrae procedencia, nivel, número de documento y fecha, y pide confirmar la lectura. La casilla del listado está deshabilitada para colaboradores. La encargada puede marcar o desmarcar manualmente con una observación obligatoria. También puede añadir un documento físico ausente del Excel con folio, datos del recuadro y motivo. Todo movimiento queda en la bitácora, con QNA, responsable y fecha; se puede buscar en QNAs anteriores y descargar un CSV completo.

La información del nuevo control se guarda solo en tablas `v2_*` del esquema aislado `"fup-sep"` del proyecto Supabase **aria-arquitectura**. El Excel original y las imágenes capturadas se procesan en el navegador y no se guardan. El progreso se actualiza cada cinco segundos. La lectura de texto usa Tesseract.js en el dispositivo y necesita Internet para descargar el lector la primera vez.

## Verificación anterior

Las salas anteriores permanecen guardadas, pero la portada ahora dirige al login. La cuenta administradora puede abrir una sala anterior con la ruta `organizar.html?s=...`; el control nuevo usa cuentas y QNAs.

Antes de crear el acceso, el avance solo se guarda en el navegador asociado al Excel. Al crear el acceso, **folio, RFC y marcas** se guardan en el esquema aislado `"fup-sep"` de la base de datos Supabase del proyecto Aria. El Excel original y las fotos no se suben. El QR se dibuja en el navegador sin enviar la clave a un servicio externo. Quien tenga el QR o el enlace puede acceder a esa lista y marcar folios; el QR no identifica a la persona. El QR anterior sigue abriendo su lista anterior y no da acceso a una lista nueva. El reconocimiento usa Tesseract.js en el dispositivo; su código y modelo de idioma se descargan por Internet la primera vez que se usa.

## Base de datos

El SQL original está en `supabase/fup-sep.sql`, la migración del control compartido en `supabase/fup-sep-v2.sql` y la restricción de administrador en `supabase/fup-sep-v3.sql`. El esquema `fup-sep` debe permanecer en **Exposed schemas** de Data API. Las funciones nuevas requieren usuarios autenticados; las tablas nuevas tienen RLS y no conceden acceso directo. La lista de cuentas administradoras vive en `"fup-sep".v2_admin_accounts`. En Auth, `https://ordenador-rfc.vercel.app/control.html` está en **Redirect URLs** para que la confirmación de correo vuelva al sitio.

## Estructura

- `dist/`: sitio listo para publicar, sin compilación.
- `vercel.json`: indica a Vercel que publique `dist/`.

## Ejecutar en la computadora

Con Node.js instalado, abre una terminal en `ordenar-fup` y ejecuta `npm run dev`. Después abre `http://127.0.0.1:5173`. No hace falta `npm install`: el servidor local usa solo Node.js y publica la carpeta `dist/`. Para detenerlo, presiona `Ctrl+C`.

El generador QR incluido en `dist/qrcode-generator.js` proviene de [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) y conserva su licencia MIT en `dist/qrcode-generator-LICENSE.txt`.

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
