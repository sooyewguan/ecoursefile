// What the report RPCs returned for a semester that scripts/capture-report-fixture.ts seeded.
// offerings, departments, facultySummary and lecturers are as the dean reads them, and
// chloeOfferings is report_offerings as Chloé Lefèvre reads it: the offerings she teaches.
import type { DepartmentRow, FacultySummary, LecturerRow, OfferingRow } from './reports.ts'

export const REPORT_FIXTURE: {
  semesterCode: string
  facultySummary: FacultySummary[]
  departments: DepartmentRow[]
  offerings: OfferingRow[]
  lecturers: LecturerRow[]
  chloeOfferings: OfferingRow[]
} = {
  "semesterCode": "2828/2829-3",
  "facultySummary": [
    {
      "offerings": 5,
      "counted_sections": 48,
      "uploaded_sections": 34,
      "verified_sections": 10,
      "needs_fix_sections": 2,
      "percent_uploaded": 70.8,
      "percent_verified": 20.8,
      "percent_needs_fix": 4.2
    }
  ],
  "departments": [
    {
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "offerings": 2,
      "counted_sections": 19,
      "uploaded_sections": 12,
      "verified_sections": 9,
      "needs_fix_sections": 1,
      "percent_uploaded": 63.2,
      "percent_verified": 47.4,
      "percent_needs_fix": 5.3
    },
    {
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "offerings": 3,
      "counted_sections": 29,
      "uploaded_sections": 22,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_uploaded": 75.9,
      "percent_verified": 3.4,
      "percent_needs_fix": 3.4
    }
  ],
  "offerings": [
    {
      "offering_id": "bf665648-03f7-42df-ad5c-df14e5842120",
      "course_code": "BITI2233-44d2d6eb",
      "course_title": "+Statistik Asas",
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "4b5bd684-ee98-42a4-9487-35951f16cc6b",
      "coordinator_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
      "status": "incomplete",
      "counted_sections": 10,
      "uploaded_sections": 3,
      "verified_sections": 0,
      "needs_fix_sections": 1,
      "percent_complete": 30,
      "missing_sections": [
        4,
        5,
        6,
        10,
        17,
        18,
        19
      ],
      "section_statuses": [
        "pending_review",
        "needs_fix",
        "pending_review",
        "missing",
        "missing",
        "missing",
        "empty",
        "empty",
        "empty",
        "missing",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "missing",
        "missing",
        "missing"
      ],
      "last_upload_at": "2026-11-20T07:31:45.281381+00:00"
    },
    {
      "offering_id": "0a596cf6-5f53-4064-aee0-dc79fc6d5f68",
      "course_code": "BITM3423-44d2d6eb",
      "course_title": "Sains Data\nGunaan",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "d676401b-b502-4204-8c9f-0eb029ff72c8",
      "coordinator_name": "@SUM(1+1)",
      "status": "pending_review",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 0,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-20T07:31:45.25177+00:00"
    },
    {
      "offering_id": "95aa6b2a-c2eb-468e-95c3-3b01f96e9467",
      "course_code": "BITP1113-44d2d6eb",
      "course_title": "Pemrograman Komputer",
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "b11f47e2-02a9-420a-b63e-96e0efa4e5e6",
      "coordinator_name": "Aisyah Rahman",
      "status": "verified",
      "counted_sections": 9,
      "uploaded_sections": 9,
      "verified_sections": 9,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "verified",
        "verified",
        "verified"
      ],
      "last_upload_at": "2026-11-20T07:31:45.32003+00:00"
    },
    {
      "offering_id": "f4b66f29-a17e-4c1b-bba8-881a78cdaab5",
      "course_code": "BITS3343-44d2d6eb",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "119cd09b-2031-4bfb-ac87-c9eaff103d9d",
      "coordinator_name": "Chloé Lefèvre",
      "status": "needs_fix",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "needs_fix",
        "empty",
        "empty",
        "empty",
        "pending_review",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-20T07:31:45.275671+00:00"
    },
    {
      "offering_id": "a7c4f792-276d-46db-966a-9dd8c18ebe01",
      "course_code": "BITU3973-44d2d6eb",
      "course_title": "Projek Sarjana Muda",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "4eaab7e2-8ab1-488e-a808-a283968c9cd0",
      "coordinator_name": "-2+3 Dash",
      "status": "incomplete",
      "counted_sections": 9,
      "uploaded_sections": 2,
      "verified_sections": 0,
      "needs_fix_sections": 0,
      "percent_complete": 22.2,
      "missing_sections": [
        2,
        4,
        5,
        6,
        17,
        18,
        19
      ],
      "section_statuses": [
        "pending_review",
        "missing",
        "pending_review",
        "missing",
        "missing",
        "missing",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "missing",
        "missing",
        "missing"
      ],
      "last_upload_at": null
    }
  ],
  "lecturers": [
    {
      "lecturer_id": "2ce062f2-b576-4fe7-bdfa-9e472923ee64",
      "lecturer_name": "\tTabbed Name",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-44d2d6eb",
          "offering_id": "a7c4f792-276d-46db-966a-9dd8c18ebe01",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "ee9afb70-fa1c-45f6-9636-0c5d995e7edc",
      "lecturer_name": "\rReturned Name",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITU3973-44d2d6eb",
          "offering_id": "a7c4f792-276d-46db-966a-9dd8c18ebe01",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "4eaab7e2-8ab1-488e-a808-a283968c9cd0",
      "lecturer_name": "-2+3 Dash",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITU3973-44d2d6eb",
          "offering_id": "a7c4f792-276d-46db-966a-9dd8c18ebe01",
          "course_title": "Projek Sarjana Muda",
          "missing_sections": [
            2,
            4,
            5,
            6,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "d676401b-b502-4204-8c9f-0eb029ff72c8",
      "lecturer_name": "@SUM(1+1)",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITM3423-44d2d6eb",
          "offering_id": "0a596cf6-5f53-4064-aee0-dc79fc6d5f68",
          "course_title": "Sains Data\nGunaan",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "4b5bd684-ee98-42a4-9487-35951f16cc6b",
      "lecturer_name": "=HYPERLINK(\"https://example.com\",\"Open\")",
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITI2233-44d2d6eb",
          "offering_id": "bf665648-03f7-42df-ad5c-df14e5842120",
          "course_title": "+Statistik Asas",
          "missing_sections": [
            5,
            6,
            10,
            17,
            18,
            19
          ]
        }
      ]
    },
    {
      "lecturer_id": "b11f47e2-02a9-420a-b63e-96e0efa4e5e6",
      "lecturer_name": "Aisyah Rahman",
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": true,
          "course_code": "BITP1113-44d2d6eb",
          "offering_id": "95aa6b2a-c2eb-468e-95c3-3b01f96e9467",
          "course_title": "Pemrograman Komputer",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "119cd09b-2031-4bfb-ac87-c9eaff103d9d",
      "lecturer_name": "Chloé Lefèvre",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "timetable_missing": false,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITP1113-44d2d6eb",
          "offering_id": "95aa6b2a-c2eb-468e-95c3-3b01f96e9467",
          "course_title": "Pemrograman Komputer",
          "missing_sections": []
        },
        {
          "coordinator": true,
          "course_code": "BITS3343-44d2d6eb",
          "offering_id": "f4b66f29-a17e-4c1b-bba8-881a78cdaab5",
          "course_title": "Pengaturcaraan \"Java\", Lanjutan",
          "missing_sections": []
        }
      ]
    },
    {
      "lecturer_id": "fb858b14-1398-4b08-9a37-d131e4b9a3bc",
      "lecturer_name": "陈伟明",
      "department_id": null,
      "department_code": null,
      "department_name": null,
      "timetable_missing": true,
      "offerings": [
        {
          "coordinator": false,
          "course_code": "BITI2233-44d2d6eb",
          "offering_id": "bf665648-03f7-42df-ad5c-df14e5842120",
          "course_title": "+Statistik Asas",
          "missing_sections": [
            4,
            5,
            6,
            10,
            17,
            18,
            19
          ]
        }
      ]
    }
  ],
  "chloeOfferings": [
    {
      "offering_id": "95aa6b2a-c2eb-468e-95c3-3b01f96e9467",
      "course_code": "BITP1113-44d2d6eb",
      "course_title": "Pemrograman Komputer",
      "department_id": "833a05f9-6967-4ed8-bf98-39c5d5018166",
      "department_code": "FTMK-44d2d6eb",
      "department_name": "Fakulti Teknologi Maklumat dan Komunikasi",
      "coordinator_id": "b11f47e2-02a9-420a-b63e-96e0efa4e5e6",
      "coordinator_name": "Aisyah Rahman",
      "status": "verified",
      "counted_sections": 9,
      "uploaded_sections": 9,
      "verified_sections": 9,
      "needs_fix_sections": 0,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "verified",
        "empty",
        "empty",
        "empty",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "verified",
        "verified",
        "verified"
      ],
      "last_upload_at": "2026-11-20T07:31:45.32003+00:00"
    },
    {
      "offering_id": "f4b66f29-a17e-4c1b-bba8-881a78cdaab5",
      "course_code": "BITS3343-44d2d6eb",
      "course_title": "Pengaturcaraan \"Java\", Lanjutan",
      "department_id": "8dcdbe21-503c-417b-95d5-9ce7f4c36b7f",
      "department_code": "JKP-44d2d6eb",
      "department_name": "Jabatan Kejuruteraan Perisian, \"Pusat\" Ünïcode",
      "coordinator_id": "119cd09b-2031-4bfb-ac87-c9eaff103d9d",
      "coordinator_name": "Chloé Lefèvre",
      "status": "needs_fix",
      "counted_sections": 10,
      "uploaded_sections": 10,
      "verified_sections": 1,
      "needs_fix_sections": 1,
      "percent_complete": 100,
      "missing_sections": [],
      "section_statuses": [
        "verified",
        "pending_review",
        "pending_review",
        "pending_review",
        "pending_review",
        "needs_fix",
        "empty",
        "empty",
        "empty",
        "pending_review",
        "off",
        "off",
        "off",
        "off",
        "off",
        "off",
        "pending_review",
        "pending_review",
        "pending_review"
      ],
      "last_upload_at": "2026-11-20T07:31:45.275671+00:00"
    }
  ]
}
