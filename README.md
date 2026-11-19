# Ordenar FUP

Aplicación estática para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador.

## Verificación de documentos

En la pestaña **Verificar documentos**, carga el Excel desde una computadora: se crea automáticamente una lista privada y su QR de acceso queda visible justo debajo del nombre del archivo. Cada carga crea una clave nueva, incluso si se vuelve a cargar el mismo archivo. Los colaboradores escanean el QR con la cámara del celular para abrir la lista sin volver a cargar el Excel. El QR permanece visible mientras esa lista esté abierta y se puede descargar como PNG. También se puede copiar el enlace como alternativa. El navegador recuerda la última sala abierta. Enfoca con la cámara el número debajo de «No. de documento». La página marca el folio solo cuando hay una coincidencia única y exacta. Si el escaneo en vivo no está disponible, usa **Abrir cámara para tomar foto**. También permite escribir el folio o marcarlo manualmente. Muestra verificados y pendientes, permite filtrar y descarga un reporte CSV. Las marcas se sincronizan aproximadamente cada cuatro segundos.

Antes de crear el acceso, el avance solo se guarda en el navegador asociado al Excel. Al crear el acceso, **folio, RFC y marcas** se guardan en el esquema aislado `"fup-sep"` de la base de datos Supabase del proyecto Aria. El Excel original y las fotos no se suben. El QR se dibuja en el navegador sin enviar la clave a un servicio externo. Quien tenga el QR o el enlace puede acceder a esa lista y marcar folios; el QR no identifica a la persona. El QR anterior sigue abriendo su lista anterior y no da acceso a una lista nueva. El reconocimiento usa Tesseract.js en el dispositivo; su código y modelo de idioma se descargan por Internet la primera vez que se usa.

## Base de datos

El SQL para crear el esquema, tablas y funciones está en `supabase/fup-sep.sql`. En la configuración Data API del proyecto Supabase de Aria hay que agregar `fup-sep` a **Exposed schemas**, conservando los esquemas existentes. Solo se otorga a `anon` ejecución de las cuatro funciones del esquema; las tablas tienen RLS activada y no tienen permisos directos para visitantes.

## Estructura

- `dist/`: sitio listo para publicar, sin compilación.
- `vercel.json`: indica a Vercel que publique `dist/`.

El generador QR incluido en `dist/qrcode-generator.js` proviene de [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) y conserva su licencia MIT en `dist/qrcode-generator-LICENSE.txt`.

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
