/**
 * Cookie con la zona horaria del navegador (R24-22). Vive en un módulo neutro
 * —ni cliente ni servidor— a propósito: si se exporta desde un fichero
 * `"use client"`, el import desde un Server Component recibe una *referencia de
 * cliente* en vez del string, y la lectura de la cookie sale `undefined`.
 */
export const TZ_COOKIE = "ey-tz";
