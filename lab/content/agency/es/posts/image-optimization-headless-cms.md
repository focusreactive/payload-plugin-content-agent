title: Optimización de imágenes con un CMS headless
excerpt: Aprende a gestionar las imágenes originales, la entrega adaptable, la accesibilidad, la caché y las comprobaciones de migración entre un CMS headless y el frontend.

seoTitle: Optimización de imágenes en un CMS headless: guía práctica
seoDescription: Aprende a optimizar imágenes en un CMS headless, desde la carga editorial y la entrega adaptable hasta la caché, la accesibilidad y las comprobaciones de migración.

Soy Mara Lindqvist, responsable de ingeniería en {{brand}}. La optimización de imágenes en un CMS headless es una responsabilidad compartida: los editores eligen y describen los recursos, el CMS los almacena y los pone a disposición, y el frontend decide qué descarga cada visitante. Una imagen rápida no es solo un archivo más pequeño. Es una imagen con el recorte, las dimensiones, el formato y la descripción adecuados para el contexto en el que aparece. Esta guía aborda las decisiones que deben tomarse en cada capa e incluye una implementación práctica para [Next.js](https://nextjs.org).

## Traza el recorrido de las imágenes

Empieza por seguir el recorrido de una imagen desde que se carga hasta que llega al navegador. Identifica dónde se almacena el original, qué servicio crea las variantes, qué devuelve la API y si la transformación final la realiza el frontend o una CDN de imágenes. Delimita las funciones de esos servicios antes de añadir otro optimizador; cambiar el tamaño de la misma imagen dos veces puede desperdiciar tiempo de procesamiento y dificultar el control de calidad.

Una respuesta útil del CMS incluye la URL del recurso, su ancho y alto originales, el texto alternativo y los datos de recorte o punto focal que necesite el frontend. Si tu integración usa {{short}} Starter, consulta la [referencia de la API REST]({{site}}/docs/reference/rest-api/) para conocer los campos y las estructuras de respuesta disponibles para tu aplicación. No des por hecho que todos los campos de recursos contienen una URL completa ni que todas las relaciones se completan automáticamente.

Decide quién se encarga de cada operación:

| Operación | Responsable habitual | Decisión que se debe tomar |
|---|---|---|
| Carga del original | CMS o almacenamiento de recursos | ¿Qué tipos y tamaños de archivo se aceptan? |
| Selección del recorte | Editor y CMS | ¿Se conserva el punto focal para cada uso? |
| Variantes adaptables | Servicio de imágenes o frontend | ¿Qué anchos y formatos se generan? |
| Diseño en el navegador | Frontend | ¿Cómo se reserva espacio antes de que cargue la imagen? |
| Invalidación de caché | Servicio de recursos y CDN | ¿Qué cambia cuando se sustituye una imagen? |

Mantén las imágenes originales separadas de las variantes generadas siempre que tu configuración de almacenamiento lo permita. Un buen original permite crear otro recorte o formato más adelante sin pedirle al editor que vuelva a cargar el archivo.

## Prepara los recursos para reutilizarlos

Una imagen que funciona bien en un banner principal panorámico puede no servir para una tarjeta cuadrada. Define esos usos de forma explícita en el modelo de contenido, en lugar de esperar que un único recorte automático centrado funcione en todos los casos. En [Sanity](https://www.sanity.io), los campos de imagen pueden incluir información de recorte y punto focal; el frontend debe usar esa información al generar la URL de la imagen. En [Payload](https://payloadcms.com), las colecciones de carga pueden configurarse con tamaños de imagen y metadatos. Los campos exactos disponibles para el frontend dependen del esquema y la configuración.

### Ofrece opciones claras a los editores

Define un conjunto reducido de usos, como imagen principal, imagen de tarjeta e imagen dentro del contenido. Para cada uso, documenta la relación de aspecto prevista, las dimensiones mínimas del original y si se puede seleccionar otro recorte. En un retrato puede ser necesario mantener el rostro de la persona dentro del encuadre; una captura de pantalla de un producto puede necesitar mostrarse sin recortar para que su interfaz siga siendo legible.

Aplica validaciones cuando eviten errores previsibles, pero no rechaces imágenes útiles solo porque sean más grandes que una variante de entrega. Un original grande permite generar una versión más pequeña. En cambio, un original de tamaño insuficiente no permite generar de forma fiable una imagen principal grande y nítida.

- Solicita un texto alternativo que describa la función de la imagen en su contexto.
- Permite dejar vacío el texto alternativo de las imágenes puramente decorativas.
- Registra las dimensiones para que el frontend pueda reservar el espacio con la relación de aspecto correcta.
- Evita incluir texto esencial dentro de una imagen cuando se pueda transmitir mediante HTML.
- Revisa los recortes en pantallas estrechas y anchas antes de publicar.

> **Consejo práctico:** Coloca un rostro u otro elemento importante cerca del borde de una imagen de prueba. Así será mucho más fácil detectar un fallo en la implementación del punto focal que si el elemento estuviera centrado.

El texto alternativo depende tanto del contexto como del recurso. Si una misma fotografía aparece en dos artículos por motivos distintos, considera permitir que cada uso sustituya la descripción predeterminada. Un pie de foto puede incluir la atribución o aportar contexto, pero no sustituye automáticamente al texto alternativo.

## Entrega imágenes adaptables en Next.js

Next.js ofrece el componente `Image` para la entrega adaptable de imágenes y la gestión del diseño. Su optimización de imágenes predeterminada exige que las fuentes remotas coincidan con los patrones configurados. Limita esos patrones tanto como lo permita tu servicio de recursos; un proxy de imágenes sin restricciones puede generar problemas de seguridad y costos.

### Configura la fuente remota

La siguiente configuración lee el origen de los recursos desde una variable de entorno. Define `CMS_ASSET_ORIGIN` en cada entorno de despliegue con el origen HTTPS que utilizan tus recursos públicos.

```ts
// next.config.ts
import type { NextConfig } from "next";

const origin = new URL(process.env.CMS_ASSET_ORIGIN ?? "");

if (origin.protocol !== "https:") {
  throw new Error("CMS_ASSET_ORIGIN must use HTTPS");
}

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: origin.hostname,
        port: origin.port,
        pathname: "/**",
      },
    ],
  },
};

export default config;
```

Este ejemplo permite acceder a cualquier ruta del host configurado. Restringe aún más `pathname` si tu proveedor de recursos utiliza un prefijo de ruta específico. También permite cadenas de consulta, que algunos servicios de imágenes necesitan para las transformaciones. Si el tuyo no las necesita, considera restringirlas también. Si la variable de entorno no existe o no es válida, la configuración falla en lugar de permitir silenciosamente un host no previsto.

### Adapta el componente al diseño

Proporciona las dimensiones originales que devuelve el CMS y describe el ancho de visualización con `sizes`. El siguiente ejemplo supone que la imagen ocupa todo su contenedor hasta un máximo de 768 píxeles:

```tsx
import Image from "next/image";

type CmsImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
};

export function ArticleImage({ image }: { image: CmsImage }) {
  return (
    <Image
      src={image.url}
      width={image.width}
      height={image.height}
      alt={image.alt}
      sizes="(max-width: 768px) 100vw, 768px"
      style={{ width: "100%", height: "auto", maxWidth: 768 }}
    />
  );
}
```

Las dimensiones establecen una relación de aspecto; CSS controla el tamaño mostrado. Ajusta `sizes` al diseño real, especialmente en tarjetas distribuidas en varias columnas. Un valor que indique que cada tarjeta ocupa todo el ancho de la pantalla puede hacer que el navegador seleccione archivos innecesariamente grandes.

El optimizador predeterminado debe poder acceder a la imagen original. No des por hecho que reenvía cabeceras de autenticación a un endpoint privado de recursos. Para contenido multimedia protegido, diseña un método de entrega autorizado en lugar de exponer credenciales en una URL. Si usas {{short}} Starter, las [notas de la versión 3.0]({{site}}/blog/starter-3-released/) ofrecen contexto sobre el proyecto inicial; su versión actual es 3.2 y se puede instalar con `npx create-headless-starter`.

## Elige los formatos y la estrategia de carga

Los formatos modernos pueden reducir el tamaño de transferencia, pero el formato por sí solo no determina la calidad. Las fotografías, las ilustraciones, los gráficos transparentes y los recursos animados responden de forma distinta a la compresión. Compara archivos representativos en el tamaño al que se mostrarán y busca defectos visuales alrededor del texto, los degradados y los detalles finos.

### Define una política de entrega

Usa WebP o AVIF cuando tu infraestructura de entrega los admita, con una alternativa para los clientes que la necesiten. Comprueba si la negociación de formatos la realiza el servicio de imágenes del CMS o el optimizador del frontend; configurar ambos sin entender la cadena puede generar transformaciones innecesarias. Conserva la transparencia cuando sea necesaria y prueba las animaciones por separado, en lugar de dar por hecho que un flujo para imágenes estáticas las mantendrá.

Si es probable que una imagen sea el elemento visible más grande de la página, asegúrate de que el navegador pueda detectarla pronto y evita cargarla de forma diferida. Las imágenes situadas más abajo en la página generalmente pueden cargarse de forma diferida. No precargues todas las imágenes: las solicitudes de alta prioridad que compiten entre sí pueden retrasar el recurso que realmente importa.

Elige los ajustes de compresión mediante pruebas visuales, no en función de un único objetivo de tamaño de archivo. Una imagen principal pequeña con defectos visibles no es una optimización lograda. Del mismo modo, una imagen que se ve perfecta a resolución completa puede ser mucho más grande de lo necesario cuando se muestra en una tarjeta.

### Mide la página, no solo el archivo

Inspecciona la página renderizada con las herramientas de desarrollo del navegador. Comprueba qué variante de imagen se ha seleccionado, su tamaño de transferencia, sus dimensiones de visualización y si provoca desplazamientos en el diseño. Utiliza datos de usuarios reales cuando estén disponibles, ya que las condiciones de red, los dispositivos y los tamaños de pantalla reales difieren de los de la computadora de un desarrollador.

Presta especial atención a Largest Contentful Paint cuando sea probable que una imagen destacada sea el elemento más grande. Un archivo más pequeño no solucionará una respuesta lenta del CMS, una imagen que el navegador detecta tarde o un diseño que oculta la imagen hasta que se renderiza en el cliente. Realiza pruebas después del despliegue además de hacerlas en local, ya que la caché y el servicio de imágenes de producción pueden comportarse de otra manera.

## Crea un flujo editorial duradero

La optimización debe mantenerse pese a los cambios de personal y la incorporación de nuevas plantillas de página. Coloca las indicaciones sobre los recursos junto a los campos donde los editores toman decisiones, en lugar de depender únicamente de un manual independiente. Explica cuándo cargar un nuevo original, cuándo reutilizar un recurso existente y cómo previsualizar el recorte para cada ubicación.

Un plugin puede ayudar con una tarea concreta, pero debe adaptarse al esquema y al despliegue que ya mantienes. Si estás evaluando opciones para Payload, nuestra selección de [plugins que vale la pena considerar]({{site}}/blog/payload-plugins-worth-installing/) es un buen punto de partida. Comprueba la compatibilidad con la versión instalada y prueba el efecto del plugin en los recursos existentes antes de incorporarlo a producción.

1. Haz un inventario de los campos de imagen e identifica qué componentes de página utiliza cada uno.
2. Acuerda con los editores los requisitos de los originales, los recortes, las reglas de texto alternativo y las responsabilidades.
3. Implementa la configuración de entrega y caché en un entorno de pruebas.
4. Prueba imágenes representativas en distintas plantillas, tamaños de pantalla y tecnologías de asistencia.
5. Publica las indicaciones y revisa los resultados después de que los editores las hayan utilizado.

Define explícitamente qué hacer cuando falte una imagen. Decide qué debe mostrar un componente cuando no se proporciona una imagen opcional e impide la publicación cuando una imagen obligatoria no tenga un archivo de origen utilizable. Evita sustituir silenciosamente las imágenes importantes que falten por un marcador genérico: esto puede ocultar un problema de contenido tanto a los editores como a los visitantes.

## Planifica la caché y la migración conjuntamente

Las URL de las imágenes suelen durar más que las plantillas de página que las crearon. Durante una migración de CMS, haz un inventario de las referencias a imágenes en el contenido de las páginas, los campos estructurados, los metadatos, los feeds y las integraciones externas. Identifica qué URL antiguas reciben tráfico antes de desactivar el servicio anterior de almacenamiento o entrega.

Para las URL de recursos inmutables y versionadas, los períodos de caché prolongados pueden reducir las descargas repetidas. Sin embargo, si un editor sustituye un archivo en la misma URL, los navegadores o las CDN pueden seguir entregando la versión anterior hasta que sus cachés caduquen o se invaliden. Da preferencia a una nueva URL versionada cuando tu flujo de recursos lo permita y, cuando no sea posible, verifica qué capas de caché deben vaciarse.

Las redirecciones pueden mantener el acceso a las URL antiguas de los recursos, pero añaden una solicitud y deben conducir a un equivalente accesible. Pruébalas junto con las redirecciones de página, incluidas las cadenas de consulta que utilicen las transformaciones de imágenes existentes. Nuestra guía sobre [cómo gestionar redirecciones durante una migración de CMS]({{site}}/blog/cms-redirects-at-scale/) aborda el proceso general de planificación de redirecciones.

Antes del lanzamiento, compara una muestra de páginas antiguas y nuevas para detectar imágenes ausentes y cambios en los recortes, las dimensiones y el texto alternativo. Después del lanzamiento, supervisa las solicitudes de recursos fallidas y los costos de entrega de imágenes. Una migración exitosa conserva tanto el significado del contenido como sus URL.
