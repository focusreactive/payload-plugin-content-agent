title: Cómo gestionar redirecciones a gran escala durante una migración de CMS
excerpt: Planifica, implementa y verifica las redirecciones de una migración de CMS sin perder de vista quién es responsable de cada URL, las señales de búsqueda ni las rutas que utilizan los visitantes.
seoTitle: Guía para gestionar redirecciones a gran escala en una migración de CMS
seoDescription: Aprende a inventariar URL antiguas, definir destinos, implementar reglas de redirección y supervisar errores durante una migración de CMS sin crear largas cadenas de redirecciones.

Soy Sofia Marchetti, responsable de SEO en {{brand}}. Una migración de CMS puede cambiar miles de URL incluso cuando el contenido permanece intacto. Las redirecciones conectan las direcciones antiguas que conocen las personas y los motores de búsqueda con las nuevas a las que necesitan acceder. El trabajo no consiste solo en escribir reglas: también hay que decidir qué páginas necesitan un destino, elegir dónde se aplicarán las reglas y comprobar que funcionan antes y después del lanzamiento.

## Crea un inventario antes de asignar destinos a las URL

Empieza por las URL que existen hoy, no solo por las páginas del CMS. Un sitio headless puede presentar contenido a través de rutas generadas por el frontend, incluidas páginas de categorías, páginas de paginación, páginas localizadas y plantillas antiguas que ya no aparecen en la navegación.

Combina un rastreo del sitio actual con una exportación del CMS, archivos de mapa del sitio, registros del servidor y datos de analítica de búsqueda, cuando estén disponibles. Cada fuente tiene sus limitaciones. Un rastreo encuentra páginas enlazadas, pero puede pasar por alto contenido huérfano; una exportación del CMS puede contener entradas sin publicar; los registros muestran las rutas solicitadas, pero no permiten determinar si cada solicitud provino de una persona, un bot o un enlace obsoleto.

Conserva las fuentes originales por separado y después crea un inventario de trabajo con una fila por cada URL distinta. Registra la fuente, el código de estado, el tipo de contenido, el idioma, la URL canónica, los indicadores de tráfico y la acción propuesta para la migración. Indica si una URL contiene una cadena de consulta que modifica el contenido. Ordenar solo por tráfico no es suficiente: una página con poco tráfico aún puede tener enlaces externos valiosos o servir para una tarea importante de los clientes.

Determina quién es responsable de cada decisión. Los responsables de contenido pueden confirmar si un artículo se va a integrar en otro; el equipo de SEO puede evaluar la intención de búsqueda y el valor de los enlaces; ingeniería puede identificar las rutas generadas fuera del CMS. Registra la persona responsable de la decisión y el estado de aprobación junto al destino propuesto para evitar que las filas pendientes se pierdan en la lista de tareas de implementación.

La elección del frontend también influye en lo que puedes generar y dónde pueden ejecutarse las redirecciones. Compara las necesidades de enrutamiento al evaluar [frameworks para sitios con mucho contenido]({{site}}/blog/top-frameworks-for-content-sites/), en lugar de dejar la gestión de URL para el final.

## Asigna destinos según la intención, no solo por la coincidencia de slugs

Una redirección debe llevar a los visitantes a la alternativa útil más cercana. Que los slugs coincidan es una pista, pero no demuestra que dos páginas cumplan el mismo propósito. Revisa el título, el contenido, el idioma y la audiencia prevista antes de aceptar una coincidencia automática.

### Elige una acción para cada URL

| Tipo de URL existente | Acción recomendada | Punto de revisión |
|---|---|---|
| Página trasladada sin cambios sustanciales | Redirigir a su nueva URL | Confirmar que el destino está activo y se puede indexar |
| Varios artículos integrados en una sola guía | Redirigir cada artículo pertinente a la guía | Comprobar que la guía cubre los temas originales |
| Página retirada sin una alternativa adecuada | Devolver un 404 o 410 | Confirmar que la eliminación es intencional |
| Página localizada trasladada a una nueva ruta | Redirigir a la página del idioma correspondiente | Evitar enviar todos los idiomas a la versión predeterminada |
| Página con filtros o parámetros | Definir una política específica para los parámetros | Comprobar si los parámetros modifican el contenido o solo sirven para el seguimiento |

No redirijas todas las páginas retiradas a la página de inicio. Esto genera una experiencia confusa y los motores de búsqueda pueden interpretarlo como un error 404 blando si el destino no responde a la solicitud original. Un 404 no implica necesariamente un fallo de la migración cuando una página se ha eliminado de forma definitiva y no tiene sustituto.

### Normaliza con cuidado

Decide cómo gestionará el nuevo sitio las mayúsculas, las barras finales, los nombres de host y los protocolos. Deja claras esas convenciones durante el proceso de asignación. Algunos servidores distinguen `/Guide` de `/guide` y otros no; prueba el comportamiento de tu propia infraestructura en lugar de darlo por hecho.

Trata los parámetros de consulta por separado de las rutas. Según tu política de analítica, puede ser adecuado conservar o descartar los parámetros de seguimiento. Los parámetros que seleccionan un producto, un idioma o un estado de búsqueda requieren una decisión explícita. Una regla general puede enviar, sin que nadie lo advierta, páginas antiguas distintas a un mismo destino que no sea pertinente.

Usa redirecciones permanentes para los traslados previstos a largo plazo y redirecciones temporales para cambios de ruta realmente temporales. Una redirección permanente es una señal importante, pero no garantiza que un motor de búsqueda transfiera de inmediato todas las señales de posicionamiento.

> **Consejo práctico:** Añade una columna de «motivo» a la hoja de asignación. Una nota como «contenido integrado en la nueva guía» agiliza mucho más las revisiones posteriores que indicar solo un destino.

## Sitúa las reglas en la capa adecuada

Las redirecciones pueden ejecutarse en la capa de CDN o alojamiento, en la aplicación o en otro componente que reciba solicitudes. Elige la primera capa que disponga de información suficiente para tomar la decisión correcta. Evita implementar la misma regla por separado en varios lugares: las reglas superpuestas son difíciles de auditar y pueden generar cadenas o bucles.

Como ejemplo a nivel de aplicación, [Next.js](https://nextjs.org) admite redirecciones en su configuración. Las siguientes reglas cubren dos rutas conocidas:

```js
// next.config.js
module.exports = {
  async redirects() {
    return [
      {
        source: '/old-guide',
        destination: '/guides/current',
        permanent: true,
      },
      {
        source: '/old-pricing',
        destination: '/pricing',
        permanent: true,
      },
    ];
  },
};
```

En Next.js, `permanent: true` utiliza una respuesta 308, mientras que `permanent: false` utiliza una 307. Ambas conservan el método de la solicitud. Una redirección destinada a una página de contenido antigua no debería afectar por accidente a un endpoint de API ni al envío de un formulario, así que revisa el alcance de las rutas y los métodos además de los destinos.

### Separa las reglas de la aplicación de las de la plataforma

Las plataformas de alojamiento como [Vercel](https://vercel.com) y [Netlify](https://www.netlify.com) ofrecen funciones de redirección, pero sus formatos de configuración, prioridades y límites varían. Consulta la documentación de la plataforma y del modo de implementación que utilizas. Una regla que funciona en el entorno local de desarrollo de la aplicación puede comportarse de manera diferente si otra capa procesa primero la solicitud.

Para una migración grande, conserva la asignación aprobada en una fuente de referencia con control de versiones y genera o importa las reglas en la capa elegida. Valida el resultado generado frente a las limitaciones de la plataforma antes de implementarlo. No des por hecho que un archivo de configuración puede contener un número ilimitado de redirecciones individuales.

Si utilizas {{short}} Starter, la [guía para organizar los archivos del proyecto]({{site}}/docs/getting-started/project-structure/) puede ayudar a tu equipo a decidir dónde ubicar el código de migración propio de la aplicación. El inventario de redirecciones debe seguir siendo accesible para los equipos de contenido y SEO, no solo para los desarrolladores.

## Prueba los destinos y el comportamiento de las redirecciones

Una hoja de asignación válida no garantiza que la implementación sea correcta. Comprueba la respuesta HTTP real, el encabezado `Location` y la página final. Es posible que el destino haya cambiado de nombre después de su aprobación, requiera autenticación o devuelva una respuesta 200 con el contenido incorrecto.

Realiza las comprobaciones en un entorno de pruebas que se parezca al de producción, incluidos la CDN y el comportamiento de los nombres de host pertinentes cuando sea posible. Después del lanzamiento, repite una selección representativa de comprobaciones en producción. Como mínimo, prueba:

- Páginas de alto valor y páginas con enlaces externos conocidos.
- Todos los patrones de reglas, no solo ejemplos individuales.
- URL localizadas y variantes con barra final o diferencias entre mayúsculas y minúsculas.
- URL con parámetros de consulta que modifican el contenido.
- Páginas eliminadas que deben devolver un 404 o 410.
- Rutas cercanas a los límites de la aplicación, incluidas API y recursos estáticos.

Usa una solicitud que no siga automáticamente las redirecciones al comprobar la primera respuesta. Define `ORIGIN` con el entorno que vas a probar antes de ejecutar:

```bash
curl -sS -o /dev/null \
  -w 'status=%{http_code} location=%{redirect_url}\n' \
  "${ORIGIN}/old-guide"
```

Inspecciona el destino indicado y luego solicítalo por separado. Debe conducir a la página final prevista sin otra redirección que se pueda evitar. Para las comprobaciones masivas, compara los códigos de estado y destinos reales con el inventario aprobado e informa de las discrepancias para que se revisen.

Prueba también los flujos de trabajo de contenido. Si publicar o cambiar un slug desencadena una nueva compilación o una invalidación de caché, verifica que las rutas antigua y nueva se comporten correctamente después del cambio. Si tu equipo utiliza {{short}} Starter, revisa el [comportamiento de los hooks disponibles]({{site}}/docs/reference/hooks/) al planificar ese flujo. No des por hecho que una actualización de contenido crea automáticamente una redirección, a menos que tu implementación lo haga de forma explícita.

## Mantén bajo control las cadenas y el rendimiento

La redirección ideal de una migración va directamente de la URL antigua a la URL canónica final. Las cadenas suelen aparecer cuando una regla antigua apunta a una ruta intermedia que luego se redirige de nuevo por una regla de nombre de host, de barra final o de la aplicación. Cada salto adicional añade otra solicitud y otra oportunidad de que falle una regla.

Antes del lanzamiento, comprueba cómo se resuelve cada destino a través de toda la infraestructura y actualiza la asignación original para que apunte directamente a la dirección final siempre que sea viable. Comprueba también que no haya bucles: dos reglas pueden enviar a un visitante de una página a otra repetidamente, aunque cada una parezca razonable por separado.

Las redirecciones son solo una parte del rendimiento. Una redirección rápida hacia un destino lento también deja al visitante esperando. Revisa las páginas de destino junto con tus [prioridades de Core Web Vitals para sitios headless]({{site}}/blog/core-web-vitals-headless-sites/) y mide el recorrido completo, no solo la respuesta de redirección.

Comprueba también los enlaces internos, los mapas del sitio XML y las etiquetas canónicas. Por lo general, deben hacer referencia a las URL finales en lugar de depender de redirecciones. Esto reduce los saltos innecesarios para visitantes y rastreadores, y facilita distinguir el tráfico procedente de URL antiguas de los enlaces que aún hay que corregir en el nuevo sitio.

## Lanza con una persona responsable y un plan de reversión

La puesta en producción de las redirecciones requiere un traspaso claro entre los equipos de contenido, SEO, ingeniería y operaciones. Acuerden la configuración de producción, la persona autorizada para modificarla y las señales que justificarían una reversión. Mantén disponibles las últimas reglas que se sabe que funcionaban y el procedimiento de implementación; un archivo de asignación por sí solo no es un plan de reversión.

1. Cierra y aprueba la asignación de la migración, incluidas las eliminaciones intencionales y las excepciones pendientes.
2. Implementa las reglas junto con las nuevas rutas y comprueba el orden en que las capas de alojamiento y de aplicación procesan las solicitudes.
3. Realiza pruebas básicas en producción para las URL prioritarias, las rutas localizadas, los casos excepcionales conocidos y las respuestas 404 o 410 esperadas.
4. Revisa los registros de errores, las respuestas de redirección, los informes de búsqueda y los reportes de soporte para detectar asignaciones omitidas o incorrectas.
5. Corrige los problemas verificados, documenta cada cambio y repite las pruebas de los patrones afectados.

La supervisión debe continuar después del día del lanzamiento. Los registros pueden revelar solicitudes de URL ausentes del rastreo original, mientras que los equipos de soporte pueden recibir avisos sobre enlaces rotos en documentos o marcadores. Los informes de búsqueda pueden ayudar a identificar cambios en la indexación, pero hay que dar tiempo al descubrimiento y procesamiento; un solo día de variaciones no basta para evaluar la migración.

Conserva las redirecciones antiguas que sigan siendo útiles mientras reciban enlaces o solicitudes reales y no generen un costo operativo inaceptable. Revísalas periódicamente en lugar de eliminar todo el conjunto de la migración en una fecha arbitraria. Si más adelante cambia un destino, actualiza también la regla original para que la URL antigua no acumule otro salto.
