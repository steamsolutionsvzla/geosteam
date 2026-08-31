#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Publicador masivo de capas desde PostGIS a GeoServer vía REST API.
Interfaz gráfica para seleccionar capas y publicarlas con cálculo automático de bounding boxes.
"""

import os
import sys
import threading
import queue
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext, Checkbutton, BooleanVar
import requests
from requests.auth import HTTPBasicAuth
import json
import psycopg2
import psycopg2.extras
from psycopg2 import sql
import re

# ========== CLASE PRINCIPAL ==========
class GeoServerPublisherApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Publicador Masivo de Capas a GeoServer")
        self.root.geometry("850x700")
        self.root.resizable(True, True)

        # Variables de configuración
        self.gs_url = tk.StringVar(value="http://localhost:8080/geoserver/rest")
        self.gs_user = tk.StringVar(value="admin")
        self.gs_pass = tk.StringVar(value="geoserver")
        self.gs_workspace = tk.StringVar(value="geosteam")
        self.gs_store = tk.StringVar(value="geosteam")

        self.db_host = tk.StringVar(value="localhost")
        self.db_port = tk.StringVar(value="5432")
        self.db_name = tk.StringVar(value="geosteam")
        self.db_user = tk.StringVar(value="postgres")
        self.db_pass = tk.StringVar(value="0907")
        self.db_schema = tk.StringVar(value="gis_data")

        self.layer_vars = {}
        self.layer_names = []
        self.log_queue = queue.Queue()

        self.build_gui()
        self.root.after(100, self.process_queues)

    # ---------- Construcción GUI ----------
    def build_gui(self):
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

        # ---- GeoServer ----
        gs_frame = ttk.LabelFrame(main_frame, text="GeoServer", padding="5")
        gs_frame.grid(row=0, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)

        ttk.Label(gs_frame, text="URL REST:").grid(row=0, column=0, sticky=tk.W, padx=2)
        ttk.Entry(gs_frame, textvariable=self.gs_url, width=40).grid(row=0, column=1, padx=5)
        ttk.Label(gs_frame, text="Usuario:").grid(row=0, column=2, sticky=tk.W, padx=2)
        ttk.Entry(gs_frame, textvariable=self.gs_user, width=12).grid(row=0, column=3, padx=5)
        ttk.Label(gs_frame, text="Contraseña:").grid(row=0, column=4, sticky=tk.W, padx=2)
        ttk.Entry(gs_frame, textvariable=self.gs_pass, width=12, show="*").grid(row=0, column=5, padx=5)

        ttk.Label(gs_frame, text="Workspace:").grid(row=1, column=0, sticky=tk.W, padx=2)
        ttk.Entry(gs_frame, textvariable=self.gs_workspace, width=15).grid(row=1, column=1, padx=5)
        ttk.Label(gs_frame, text="Store (PostGIS):").grid(row=1, column=2, sticky=tk.W, padx=2)
        ttk.Entry(gs_frame, textvariable=self.gs_store, width=15).grid(row=1, column=3, padx=5)

        # ---- PostGIS ----
        db_frame = ttk.LabelFrame(main_frame, text="Base de datos PostGIS (para calcular bounds)", padding="5")
        db_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)

        ttk.Label(db_frame, text="Host:").grid(row=0, column=0, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_host, width=12).grid(row=0, column=1, padx=5)
        ttk.Label(db_frame, text="Puerto:").grid(row=0, column=2, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_port, width=6).grid(row=0, column=3, padx=5)
        ttk.Label(db_frame, text="BD:").grid(row=0, column=4, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_name, width=12).grid(row=0, column=5, padx=5)
        ttk.Label(db_frame, text="Usuario:").grid(row=1, column=0, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_user, width=12).grid(row=1, column=1, padx=5)
        ttk.Label(db_frame, text="Contraseña:").grid(row=1, column=2, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_pass, width=12, show="*").grid(row=1, column=3, padx=5)
        ttk.Label(db_frame, text="Esquema:").grid(row=1, column=4, sticky=tk.W, padx=2)
        ttk.Entry(db_frame, textvariable=self.db_schema, width=12).grid(row=1, column=5, padx=5)

        # ---- Botones ----
        btn_frame = ttk.Frame(main_frame)
        btn_frame.grid(row=2, column=0, columnspan=2, pady=5)
        ttk.Button(btn_frame, text="Cargar lista de capas", command=self.load_layers).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_frame, text="Seleccionar todas", command=self.select_all).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_frame, text="Deseleccionar todas", command=self.deselect_all).pack(side=tk.LEFT, padx=5)

        # ---- Lista de capas ----
        list_frame = ttk.LabelFrame(main_frame, text="Capas disponibles", padding="5")
        list_frame.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)

        canvas = tk.Canvas(list_frame, height=200)
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=canvas.yview)
        self.scrollable_frame = ttk.Frame(canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # ---- Publicar ----
        ttk.Button(main_frame, text="PUBLICAR CAPAS SELECCIONADAS", command=self.start_publish,
                   style="Accent.TButton").grid(row=4, column=0, columnspan=2, pady=10)

        # ---- Progreso ----
        self.progress = ttk.Progressbar(main_frame, orient=tk.HORIZONTAL, length=600, mode='determinate')
        self.progress.grid(row=5, column=0, columnspan=2, pady=5, sticky=(tk.W, tk.E))

        # ---- Logs ----
        log_frame = ttk.LabelFrame(main_frame, text="Registro de eventos", padding="5")
        log_frame.grid(row=6, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        self.log_text = scrolledtext.ScrolledText(log_frame, height=12, state='disabled', wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True)

        # Pesos
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(3, weight=1)

        style = ttk.Style()
        style.theme_use('clam')
        style.configure("Accent.TButton", foreground="white", background="#2a82da", padding=6)

    # ---------- Funciones auxiliares ----------
    def log(self, msg, level="INFO"):
        self.log_queue.put((msg, level))

    def process_queues(self):
        try:
            while True:
                msg, level = self.log_queue.get_nowait()
                self.log_text.config(state='normal')
                if level == "ERROR":
                    self.log_text.insert(tk.END, f"[ERROR] {msg}\n", "error")
                elif level == "WARNING":
                    self.log_text.insert(tk.END, f"[AVISO] {msg}\n", "warning")
                else:
                    self.log_text.insert(tk.END, f"[INFO] {msg}\n", "info")
                self.log_text.see(tk.END)
                self.log_text.config(state='disabled')
        except queue.Empty:
            pass
        self.root.after(100, self.process_queues)

    def update_progress(self, value, max_value):
        self.progress['maximum'] = max_value
        self.progress['value'] = value
        self.root.update_idletasks()

    def select_all(self):
        for var in self.layer_vars.values():
            var.set(True)

    def deselect_all(self):
        for var in self.layer_vars.values():
            var.set(False)

    # ---------- Cargar capas ----------
    def load_layers(self):
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.layer_vars = {}
        self.layer_names = []

        try:
            conn = psycopg2.connect(
                host=self.db_host.get(),
                port=self.db_port.get(),
                dbname=self.db_name.get(),
                user=self.db_user.get(),
                password=self.db_pass.get()
            )
            cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
            schema = self.db_schema.get().strip()

            # Detectar columnas de geometría
            cur.execute("""
                SELECT DISTINCT table_name
                FROM information_schema.columns
                WHERE table_schema = %s
                  AND udt_name IN ('geometry', 'geography')
                ORDER BY table_name
            """, (schema,))
            tables = cur.fetchall()
            cur.close()
            conn.close()

            if not tables:
                self.log(f"No se encontraron tablas con geometría en el esquema '{schema}'.", "WARNING")
                messagebox.showwarning("Sin capas", f"No hay tablas con geometría en el esquema '{schema}'.")
                return

            for row in tables:
                name = row[0]
                var = BooleanVar(value=False)
                cb = Checkbutton(self.scrollable_frame, text=name, variable=var, anchor="w")
                cb.pack(fill=tk.X, padx=2, pady=1)
                self.layer_vars[name] = var
                self.layer_names.append(name)

            self.log(f"Se cargaron {len(tables)} capas desde el esquema '{schema}'.")
            messagebox.showinfo("Capas cargadas", f"Se encontraron {len(tables)} capas geográficas.")

        except Exception as e:
            self.log(f"Error al cargar capas: {e}", "ERROR")
            messagebox.showerror("Error", f"No se pudo conectar a PostGIS o listar tablas:\n{e}")

    # ---------- Iniciar publicación ----------
    def start_publish(self):
        selected = [name for name, var in self.layer_vars.items() if var.get()]
        if not selected:
            messagebox.showwarning("Sin selección", "Selecciona al menos una capa para publicar.")
            return

        try:
            r = requests.get(self.gs_url.get(), auth=(self.gs_user.get(), self.gs_pass.get()))
            if r.status_code != 200:
                raise Exception(f"Error de autenticación (código {r.status_code})")
        except Exception as e:
            self.log(f"No se pudo conectar a GeoServer: {e}", "ERROR")
            messagebox.showerror("Error", f"No se pudo conectar a GeoServer:\n{e}")
            return

        self.log(f"Iniciando publicación de {len(selected)} capas...")
        self.progress['value'] = 0
        self.progress['maximum'] = len(selected)

        thread = threading.Thread(target=self.publish_layers, args=(selected,), daemon=True)
        thread.start()

    # ---------- Publicación (hilo) ----------
    def publish_layers(self, selected_layers):
        gs_url = self.gs_url.get().rstrip('/')
        workspace = self.gs_workspace.get().strip()
        store = self.gs_store.get().strip()
        auth = (self.gs_user.get(), self.gs_pass.get())

        try:
            conn = psycopg2.connect(
                host=self.db_host.get(),
                port=self.db_port.get(),
                dbname=self.db_name.get(),
                user=self.db_user.get(),
                password=self.db_pass.get()
            )
            conn.autocommit = True
            cur = conn.cursor()
        except Exception as e:
            self.log(f"No se pudo conectar a PostGIS: {e}", "ERROR")
            self.root.after(0, lambda: messagebox.showerror("Error", f"No se pudo conectar a PostGIS:\n{e}"))
            return

        success_count = 0
        for i, table_name in enumerate(selected_layers, 1):
            self.update_progress(i, len(selected_layers))
            self.log(f"Publicando {table_name}...")

            try:
                # ---- Detectar automáticamente la columna de geometría ----
                cur.execute("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = %s
                      AND table_name = %s
                      AND udt_name IN ('geometry', 'geography')
                """, (self.db_schema.get(), table_name))
                geom_col = cur.fetchone()
                if not geom_col:
                    self.log(f"  ⚠️ No se encontró columna de geometría en {table_name}. Saltando.", "WARNING")
                    continue
                geom_col = geom_col[0]

                # ---- Calcular extent ----
                query = sql.SQL("SELECT ST_Extent({}) AS extent FROM {}.{}").format(
                    sql.Identifier(geom_col),
                    sql.Identifier(self.db_schema.get()),
                    sql.Identifier(table_name)
                )
                cur.execute(query)
                row = cur.fetchone()
                if not row or row[0] is None:
                    self.log(f"  ⚠️ {table_name} no tiene geometrías o está vacía. Saltando.", "WARNING")
                    continue

                extent_str = row[0]
                coords = re.findall(r'[\d.\-]+', extent_str)
                if len(coords) != 4:
                    self.log(f"  ⚠️ No se pudo parsear el extent de {table_name}. Saltando.", "WARNING")
                    continue
                minx, miny, maxx, maxy = map(float, coords)

                # ---- Payload ----
                payload = {
                    "featureType": {
                        "name": table_name,
                        "nativeName": table_name,
                        "title": table_name,
                        "srs": "EPSG:4326",
                        "projectionPolicy": "FORCE_DECLARED",
                        "enabled": True,
                        "metadata": {
                            "entry": [{"@key": "cachingEnabled", "$": "false"}]
                        },
                        "nativeBoundingBox": {
                            "minx": minx,
                            "miny": miny,
                            "maxx": maxx,
                            "maxy": maxy,
                            "crs": "EPSG:4326"
                        },
                        "latLonBoundingBox": {
                            "minx": minx,
                            "miny": miny,
                            "maxx": maxx,
                            "maxy": maxy,
                            "crs": "EPSG:4326"
                        }
                    }
                }

                # ---- POST ----
                url = f"{gs_url}/workspaces/{workspace}/datastores/{store}/featuretypes"
                resp = requests.post(url, auth=auth, json=payload, headers={"Content-Type": "application/json"})

                if resp.status_code in (201, 200):
                    self.log(f"  ✅ {table_name} publicada correctamente.")
                    success_count += 1
                elif resp.status_code == 409:
                    self.log(f"  ⚠️ {table_name} ya existe. Actualizando bounds...", "WARNING")
                    get_url = f"{url}/{table_name}.json"
                    get_resp = requests.get(get_url, auth=auth)
                    if get_resp.status_code == 200:
                        existing = get_resp.json()
                        existing['featureType']['nativeBoundingBox'] = payload['featureType']['nativeBoundingBox']
                        existing['featureType']['latLonBoundingBox'] = payload['featureType']['latLonBoundingBox']
                        put_resp = requests.put(get_url, auth=auth, json=existing,
                                                headers={"Content-Type": "application/json"})
                        if put_resp.status_code in (200, 201):
                            self.log(f"  ✅ {table_name} actualizada con nuevos bounds.")
                            success_count += 1
                        else:
                            self.log(f"  ❌ Error al actualizar {table_name}: {put_resp.text}", "ERROR")
                    else:
                        self.log(f"  ❌ No se pudo obtener {table_name} para actualizar: {get_resp.text}", "ERROR")
                else:
                    self.log(f"  ❌ Error al publicar {table_name}: {resp.text}", "ERROR")

            except Exception as e:
                self.log(f"  ❌ Error procesando {table_name}: {e}", "ERROR")

        cur.close()
        conn.close()

        self.update_progress(len(selected_layers), len(selected_layers))
        self.log(f"Proceso finalizado. {success_count} de {len(selected_layers)} capas publicadas/actualizadas.")
        self.root.after(0, lambda: messagebox.showinfo("Completado",
                      f"Publicación finalizada.\n{success_count} capas procesadas correctamente."))

# ========== PUNTO DE ENTRADA ==========
if __name__ == "__main__":
    root = tk.Tk()
    app = GeoServerPublisherApp(root)
    root.mainloop()