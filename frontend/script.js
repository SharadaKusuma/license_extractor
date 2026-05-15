async function upload() {
    const file = document.getElementById("fileInput").files[0];

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("http://localhost:3000/api/v1/license/analyze-license", {
        method: "POST",
        body: formData
    });

    const data = await res.json();

    document.getElementById("output").textContent = JSON.stringify(data, null, 2);
}