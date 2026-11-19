import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { supabase } from '../supabase.ts'

type Department = { id: string; code: string; name: string }

export function Departments() {
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('departments').select('id, code, name').order('code')
    if (error) setMessage(error.message)
    else setDepartments(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(write: PromiseLike<{ error: { message: string } | null }>, form?: HTMLFormElement) {
    const { error } = await write
    setMessage(error?.message ?? null)
    if (!error) form?.reset()
    await reload()
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void run(
      supabase.from('departments').insert({ code: String(form.get('code')), name: String(form.get('name')) }),
      event.currentTarget,
    )
  }

  function onSave(event: FormEvent<HTMLFormElement>, department: Department) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void run(
      supabase
        .from('departments')
        .update({ code: String(form.get('code')), name: String(form.get('name')) })
        .eq('id', department.id),
    )
  }

  if (!departments) return <p>Loading…</p>

  return (
    <main className="wide">
      <p>
        <Link to="/">Home</Link>
      </p>
      <h1>Departments</h1>
      {message && <p role="status">{message}</p>}

      <form onSubmit={onCreate} aria-label="Add a department">
        <h2>Add a department</h2>
        <label>
          Code
          <input name="code" required />
        </label>
        <label>
          Name
          <input name="name" required />
        </label>
        <button type="submit">Add department</button>
      </form>

      <ul>
        {departments.map((department) => (
          // The key includes the values, so the inputs show the saved values after each reload.
          <li key={`${department.id}:${department.code}:${department.name}`}>
            <form onSubmit={(event) => onSave(event, department)} aria-label={`Department ${department.code}`}>
              <input name="code" defaultValue={department.code} aria-label="Code" required />
              <input name="name" defaultValue={department.name} aria-label="Name" required />
              <button type="submit">Save</button>
              <button
                type="button"
                onClick={() => void run(supabase.from('departments').delete().eq('id', department.id))}
              >
                Delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
