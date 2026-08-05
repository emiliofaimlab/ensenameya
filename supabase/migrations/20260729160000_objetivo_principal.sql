-- ============================================================================
-- "Tu objetivo principal" del alumno (decisión 30 del cliente, 24-jul · EP-23)
--
-- El Figma lo pinta en AL01 paso 2 y `profiles` no tenía el campo. En su
-- momento se frenó porque el diseño no traía la lista de opciones; el cliente
-- la confirmó el 24-jul (seis).
--
-- Texto con check en vez de enum: la lista es de producto y va a moverse; un
-- enum obliga a migración para añadir una opción y no se pueden quitar valores.
-- El check acepta nulo porque el campo es opcional y porque los alumnos que ya
-- pasaron por el asistente no lo tienen.
-- ============================================================================

alter table public.profiles
  add column if not exists primary_goal text
    check (primary_goal is null or primary_goal in (
      'reforzar_materia',
      'examen_certificacion',
      'habilidad_nueva',
      'trabajo_carrera',
      'practicar_idioma',
      'hobby_personal'
    ));

comment on column public.profiles.primary_goal is
  'Objetivo del alumno declarado en AL01 (decisión 30). Opcional; la etiqueta visible vive en el frontend.';

-- El alumno edita SU perfil: la política `profiles_update_own` ya acota la
-- fila, y el grant por columna sigue el patrón de US-201 (nada de `update`
-- abierto sobre la tabla, que abriría la escalada que evita US-1403).
grant update (primary_goal) on public.profiles to authenticated;
